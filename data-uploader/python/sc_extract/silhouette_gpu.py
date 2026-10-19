"""Optional OpenGL rasteriser for the silhouette mask (``SC_USE_GPU=1``).

Draws the top-down triangles into an R8 framebuffer of exactly the mask size
through a headless moderngl context (WGL on Windows, no window shown) and
reads it back as the boolean mask `silhouette.rasterize_mask` returns.

Why it matches the CPU rule: OpenGL rasterisation samples each pixel at its
centre (``col + .5, row + .5``) — the same point the CPU scanline tests — and
window row 0 is the mask's row 0 (min Y), so no flip. It is NOT bit-identical:
vertices are float32 on the GPU (float64 on the CPU) and a centre lying
exactly on an edge follows GL's top-left rule instead of the CPU's
``-1e-6`` barycentric slack. Both only move isolated edge pixels, which the
1px morphological close/open and the >= 1.5px Douglas-Peucker tolerance
absorb; `tests/test_silhouette_gpu.py` pins that. The cache is shared between
both backends on purpose: either result is a valid silhouette of the mesh.

Thread-safety: one context per process, created lazily, used under a lock
(GL contexts are bound to one thread at a time; the silhouette build runs
meshes on worker threads). Any failure — no moderngl, no driver, a context
that cannot be made current — disables the GPU path for the rest of the
process with its reason, and the caller falls back to the CPU rasteriser.

GPU share: every GPU unit (one mask, one set of depth maps) is followed by
the duty-cycle pause of `gpu_share.pace` (``SC_GPU_SHARE`` < 100), taken
while the lock is still held so no other thread refills the gap.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Dict, Optional

import numpy as np

from . import gpu_share

_lock = threading.Lock()
_ctx: Any = None
_prog: Any = None
_status: Optional[Dict[str, Any]] = None
_on_disable: Any = None

_VERT = """
#version 330
uniform vec2 size;
in vec2 in_px;
void main() {
    gl_Position = vec4(in_px / size * 2.0 - 1.0, 0.0, 1.0);
}
"""
_FRAG = """
#version 330
out float mask;
void main() { mask = 1.0; }
"""


def _create() -> Dict[str, Any]:
    global _ctx, _prog
    try:
        import moderngl  # noqa: PLC0415 — optional native dependency
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "name": None, "reason": f"moderngl not importable: {exc}"}
    try:
        ctx = moderngl.create_standalone_context(require=330)
        prog = ctx.program(vertex_shader=_VERT, fragment_shader=_FRAG)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "name": None,
                "reason": f"no OpenGL 3.3 context: {type(exc).__name__}: {exc}"}
    _ctx, _prog = ctx, prog
    info = ctx.info
    name = str(info.get("GL_RENDERER") or "unknown renderer")
    vendor = str(info.get("GL_VENDOR") or "")
    # A software rasteriser (Mesa llvmpipe/softpipe, Microsoft's GDI fallback)
    # is a CPU in disguise — slower than the numpy path, not a GPU.
    low = f"{name} {vendor}".lower()
    if any(s in low for s in ("llvmpipe", "softpipe", "gdi generic", "swiftshader", "microsoft basic")):
        _ctx = _prog = None
        try:
            ctx.release()
        except Exception:  # noqa: BLE001
            pass
        return {"available": False, "name": name, "reason": "software OpenGL renderer only"}
    return {"available": True, "name": name, "reason": None}


def status() -> Dict[str, Any]:
    """``{"available": bool, "name": str|None, "reason": str|None}`` — probes
    (creates the context) on first call, cached afterwards."""
    global _status
    with _lock:
        if _status is None:
            _status = _create()
        return dict(_status)


def disable(reason: str) -> None:
    """Turn the GPU path off for this process (a draw failed at runtime)."""
    global _status, _ctx, _prog
    with _lock:
        _status = {"available": False, "name": (_status or {}).get("name"),
                   "reason": f"disabled after a runtime error: {reason}"}
        _ctx = _prog = None
    if _on_disable:
        try:
            _on_disable(reason)
        except Exception:  # noqa: BLE001
            pass


def set_disable_hook(fn: Any) -> None:
    """``fn(reason)`` is called once when a runtime error turns the GPU off —
    the build app logs it as the one fallback line."""
    global _on_disable
    _on_disable = fn


def rasterize(px: np.ndarray, width: int, height: int) -> np.ndarray:
    """``(n, 3, 2)`` pixel-space triangles -> ``(height, width)`` bool mask."""
    if not status()["available"]:
        raise RuntimeError("GPU rasteriser unavailable")
    with _lock:
        ctx, prog = _ctx, _prog
        if ctx is None:
            raise RuntimeError("GPU rasteriser unavailable")
        if px.shape[0] == 0:
            return np.zeros((height, width), dtype=bool)
        t0 = time.perf_counter()
        with ctx:  # make current on THIS thread
            vbo = ctx.buffer(np.ascontiguousarray(px, dtype="f4").tobytes())
            rbo = ctx.renderbuffer((width, height), components=1, dtype="f1")
            fbo = ctx.framebuffer(color_attachments=[rbo])
            vao = ctx.vertex_array(prog, [(vbo, "2f", "in_px")])
            try:
                fbo.use()
                ctx.viewport = (0, 0, width, height)
                ctx.disable(ctx.CULL_FACE | ctx.DEPTH_TEST | ctx.BLEND)
                fbo.clear(0.0, 0.0, 0.0, 0.0)
                prog["size"].value = (float(width), float(height))
                vao.render(mode=ctx.TRIANGLES)
                raw = fbo.read(components=1, dtype="f1", alignment=1)
            finally:
                for obj in (vao, fbo, rbo, vbo):
                    obj.release()
        # The read-back synchronised the GPU, so t covers the real work.
        gpu_share.pace(time.perf_counter() - t0)
    return np.frombuffer(raw, dtype=np.uint8).reshape(height, width) > 0


# ── point-splat depth maps (the 3D hull hole gate, `mesh_integrity.py`) ────

_SPLAT_VERT = """
#version 330
uniform vec3 origin;
uniform vec3 u;
uniform vec3 v;
uniform vec3 d;
uniform float pix;
uniform float res;
in vec3 in_p;
out float depth;
void main() {
    vec3 rel = in_p - origin;
    vec2 xy = vec2(dot(rel, u), dot(rel, v)) / pix;
    depth = dot(rel, d);
    gl_Position = vec4(xy / res * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
}
"""
_SPLAT_FRAG = """
#version 330
in float depth;
out float min_depth;
void main() { min_depth = depth; }
"""
_splat_prog: Any = None
_FAR = 3.0e38


def splat_depth_maps(pts: np.ndarray, center: np.ndarray, views, pix: float,
                     res: int) -> list:
    """GPU twin of `mesh_integrity._depth_map` for many views at once.

    ``views`` = ``[(d, u, v, origin), ...]``; returns one ``(res, res)``
    float64 map per view (``inf`` = no point). A size-1 point covers the pixel
    ``floor(x), floor(y)`` its window position falls in — the CPU binning —
    and ``MIN`` blending keeps the nearest depth per pixel, which is what
    ``np.minimum.at`` does. Coordinates are uploaded relative to ``center`` so
    float32 keeps sub-millimetre precision on a 100 m hull.
    """
    global _splat_prog
    if not status()["available"]:
        raise RuntimeError("GPU unavailable")
    import moderngl  # noqa: PLC0415
    with _lock:
        ctx = _ctx
        if ctx is None:
            raise RuntimeError("GPU unavailable")
        t0 = time.perf_counter()
        with ctx:
            if _splat_prog is None:
                _splat_prog = ctx.program(vertex_shader=_SPLAT_VERT, fragment_shader=_SPLAT_FRAG)
            prog = _splat_prog
            out = []
            if not len(pts):
                return [np.full((res, res), np.inf) for _ in views]
            vbo = ctx.buffer(np.ascontiguousarray(pts - center, dtype="f4").tobytes())
            rbo = ctx.renderbuffer((res, res), components=1, dtype="f4")
            fbo = ctx.framebuffer(color_attachments=[rbo])
            vao = ctx.vertex_array(prog, [(vbo, "3f", "in_p")])
            try:
                fbo.use()
                ctx.viewport = (0, 0, res, res)
                ctx.disable(ctx.CULL_FACE | ctx.DEPTH_TEST | ctx.PROGRAM_POINT_SIZE)
                ctx.point_size = 1.0
                ctx.enable(ctx.BLEND)
                ctx.blend_equation = moderngl.MIN
                prog["pix"].value = float(pix)
                prog["res"].value = float(res)
                for d, u, v, origin in views:
                    fbo.clear(_FAR, 0.0, 0.0, 0.0)
                    prog["d"].value = tuple(float(x) for x in d)
                    prog["u"].value = tuple(float(x) for x in u)
                    prog["v"].value = tuple(float(x) for x in v)
                    prog["origin"].value = tuple(float(x) for x in (origin - center))
                    vao.render(mode=ctx.POINTS)
                    m = np.frombuffer(fbo.read(components=1, dtype="f4", alignment=1),
                                      dtype=np.float32).reshape(res, res).astype(np.float64)
                    m[m >= _FAR * 0.5] = np.inf
                    out.append(m)
            finally:
                ctx.blend_equation = moderngl.FUNC_ADD
                ctx.disable(ctx.BLEND)
                for obj in (vao, fbo, rbo, vbo):
                    obj.release()
        gpu_share.pace(time.perf_counter() - t0)
    return out
