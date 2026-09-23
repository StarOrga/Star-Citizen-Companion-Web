"""3D hull export: turn a ship's CryEngine geometry from the P4K into ONE
web-ready, geometry-only glTF per ship (plus the official store icon of every
paint) — 100% from the P4K, no external data sources.

Pipeline (per ship):
    p4k  -> .cga + .cgam + one paint .mtl              (scdatatools)
         -> cgf-converter                               -> raw glb
         -> un-rig + interior strip + strip_to_geometry -> shape only
         -> gltf-transform optimize (simplify+meshopt)  -> web glb

No texture ever leaves the P4K: the published hull carries the ship's shape,
not CIG's texture art (RSI Fankit & Fandom FAQ: no uploading their content for
"download by others"). The web viewer renders it as a hologram. The paint .mtl
is still handed to the converter because it names the submaterials, which is
how proxies and the interior are recognised and dropped.

External *build tools* (NOT data sources — data is 100% P4K):
  * cgf-converter v2.0.0+  (Markemp/Cryengine-Converter) — parses SC 4.x Ivo
    geometry that scdatatools 1.0.4 cannot. Fetched once via tools/fetch_tools.py.
  * @gltf-transform/cli    — BUNDLED with the desktop app. The packaged build
    runs it through Electron's own Node (ELECTRON_RUN_AS_NODE), so end users need
    no global Node/npx. `npx @gltf-transform/cli@latest` is only the dev fallback
    when the bundled CLI is not resolvable.

Ship geometry/paint locations come from `ship_discovery.py`, which pattern-matches
the P4K layout to build a `ShipSpec` for ANY ship. `cutlass_pilot.py` remains the
explicit hand-wired reference (the original Cutlass Black pilot).
"""
from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

LogFn = Callable[[str, str], None]

# Adaptive size-budget floors: how far the retry ladder may degrade a skin that
# blows the per-model budget before we give up and keep the smallest attempt.
MIN_TEXTURE_SIZE = 256
MAX_SIMPLIFY_ERROR = 0.01

# Identifiers that flow into filenames, storage object paths, and (on Windows)
# a shell=True command line MUST be restricted to a safe charset — no path
# separators, no '..', no cmd.exe metacharacters (& ^ | % < > " etc.).
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def safe_id(value: str, kind: str) -> str:
    """Validate an id used in paths/commands; raise on anything unsafe."""
    if not value or not _SAFE_ID.match(value):
        raise ValueError(f"unsafe {kind} {value!r} — must match [A-Za-z0-9_-]+")
    return value


# cmd.exe metacharacters. Windows paths never legitimately contain these, so a
# hit means a crafted/hostile path — we refuse rather than trust list2cmdline
# quoting as a security boundary (BatBadBut class of shell injection).
_SHELL_META = re.compile(r'[&|^<>%"]')


def _safe_join(base: Path, *parts: str) -> Path:
    """Join archive/CLI-controlled segments under `base`, refusing any result
    that escapes it (zip-slip / path traversal). P4K entry names and .mtl
    texture references are untrusted content in a crafted or corrupt archive:
    a `..`-laden or drive-rooted entry must never write outside `base`."""
    base = base.resolve()
    dest = (base / Path(*parts)).resolve()
    if not dest.is_relative_to(base):
        raise ValueError(f"path escapes {base}: {parts!r}")
    return dest


def _reject_shell_meta(argv: List[str]) -> None:
    """Guard a cmd.exe-bound argv: raise if any element carries a shell
    metacharacter (the glb paths derive from the CLI --out/--work dirs)."""
    for a in argv:
        if _SHELL_META.search(a):
            raise ValueError(f"refusing shell exec: metacharacter in {a!r}")


def _noop(level: str, msg: str) -> None:  # default logger
    pass


@dataclass
class Paint:
    """One paint/livery: its material file + display metadata."""
    mtl: str                      # P4K path to the paint .mtl
    id: str                       # slug, e.g. "pirate"
    name: str = ""                # official name (localization)
    description: str = ""
    icon_dds: Optional[str] = None  # P4K path to the store icon .dds
    source: str = "store"         # store|event|subscriber|factory|pu_npc
    name_verified: bool = False


@dataclass
class ShipSpec:
    """Where a ship's geometry + paints live in the P4K (Cutlass pilot)."""
    ship_id: str                  # "DRAK_Cutlass_Black"
    hull_cga: str                 # P4K path to the whole-ship .cga
    objectdir_anchor: str         # P4K dir that is the cgf-converter -objectdir root (contains Objects/)
    paints: List[Paint] = field(default_factory=list)


@dataclass
class HullExportConfig:
    cgf_converter: Path           # path to cgf-converter(-2).exe
    out_dir: Path                 # where web glbs + catalog land
    work_dir: Path                # scratch (mirrored Data tree, raw glbs)
    # 512 (not 1024) is the catalog-wide default: textures are ~70 % of a web
    # glb, and the Supabase free plan leaves ~150 MB for the whole ship-skins
    # bucket. See the "Storage budget" section of HULL3D.md for the arithmetic.
    texture_size: int = 512
    simplify_error: float = 0.002
    # Per-model size budget. A skin over budget is re-optimized down the quality
    # ladder (halve textures, coarsen simplify) until it fits — so only the heavy
    # skins lose fidelity, not the whole catalog. 0 disables the budget.
    #
    # Deliberately NOT raised for the draco->meshopt swap (#305). meshopt is
    # ~1.56x draco on the MESH, but textures are ~70 % of a web glb, so the
    # end-to-end effect is far smaller than 1.56x — and the ladder already
    # handles an over-budget model deterministically. Expect it to step down one
    # rung more often than before; re-tune this from the real per-skin sizes of
    # the first full meshopt re-export rather than from an estimate.
    max_model_bytes: int = 600_000
    # Drop the ship's interior geometry/textures. The Showroom is an exterior
    # viewer; the interior is a quarter of the triangles and the bulk of the
    # texture payload, and is never visible in the viewer.
    strip_interior: bool = True
    on_log: LogFn = _noop
    keep_work: bool = False       # keep scratch for debugging


# Written into skins.json. A cached ship built by an older pipeline (the textured
# one-glb-per-skin export) carries no or another format and must be rebuilt —
# `skin_export_app --skip-existing` compares against this.
EXPORT_FORMAT = "geometry-v1"


def hull_paint(paints: List[Paint]) -> Optional[Paint]:
    """The paint whose .mtl names the hull's submaterials for the one build.

    Any paint would do for the geometry; the factory finish is the one every
    ship has, so it is the most predictable choice.
    """
    for pred in (lambda p: p.id == "standard", lambda p: p.source == "factory",
                 lambda p: True):
        for p in paints:
            if p.mtl and pred(p):
                return p
    return None


class Hull3DExporter:
    """Builds one geometry-only web glb per ship + a paint catalog."""

    def __init__(self, p4k, cfg: HullExportConfig) -> None:
        self.p4k = p4k
        # resolve all paths to absolute — subprocess runs with cwd in the mesh dir
        cfg.cgf_converter = cfg.cgf_converter.resolve()
        cfg.out_dir = cfg.out_dir.resolve()
        cfg.work_dir = cfg.work_dir.resolve()
        self.cfg = cfg
        self.log = cfg.on_log
        self._byname = {i.filename.replace("\\", "/"): i for i in p4k.infolist()}
        self._ddsidx: Dict[str, object] = {}
        for i in p4k.infolist():
            fn = i.filename.lower().replace("\\", "/")
            if ".dds" in fn:
                self._ddsidx.setdefault(fn.split(".dds")[0] + ".dds", i)
        cfg.out_dir.mkdir(parents=True, exist_ok=True)
        cfg.work_dir.mkdir(parents=True, exist_ok=True)

    # ---- P4K helpers -------------------------------------------------------
    def _read(self, p4k_path: str) -> bytes:
        info = self._byname.get(p4k_path.replace("\\", "/"))
        if not info:
            # case-insensitive fallback
            low = p4k_path.lower().replace("\\", "/")
            for fn, i in self._byname.items():
                if fn.lower() == low:
                    info = i
                    break
        if not info:
            raise FileNotFoundError(p4k_path)
        return self.p4k.open(info).read()

    def _mirror_save(self, p4k_path: str, root: Path) -> Path:
        dest = _safe_join(root, p4k_path.replace("\\", "/"))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self._read(p4k_path))
        return dest

    # ---- build tools -------------------------------------------------------
    def _cgf_to_glb(self, cga_disk: Path, objectdir: Path, mtl_rel: Optional[str],
                    out_glb: Path) -> None:
        produced = cga_disk.with_suffix(".glb")
        produced.unlink(missing_ok=True)  # never mistake a stale glb for success
        cmd = [str(self.cfg.cgf_converter), cga_disk.name, "-glb",
               "-objectdir", str(objectdir), "-loglevel", "Error"]
        if mtl_rel:
            cmd += ["-mtl", mtl_rel]
        r = subprocess.run(cmd, cwd=str(cga_disk.parent), capture_output=True, timeout=600)
        # cgf-converter's exit code is unreliable (non-zero on success in some
        # paths), so the freshly-produced output file is the success signal —
        # robust now that any stale glb was unlinked above. rc is logged only.
        if not produced.exists() or produced.stat().st_size < 4096:
            raise RuntimeError(
                f"cgf-converter produced no usable glb for {cga_disk.name} (rc={r.returncode})")
        produced.replace(out_glb)

    def _optimize(self, in_glb: Path, out_glb: Path,
                  texture_size: Optional[int] = None,
                  simplify_error: Optional[float] = None) -> None:
        import json as _json
        import os
        import sys
        ts = self.cfg.texture_size if texture_size is None else texture_size
        err = self.cfg.simplify_error if simplify_error is None else simplify_error
        flags = ["optimize", str(in_glb.resolve()), str(out_glb.resolve()),
                 "--texture-compress", "webp", "--texture-size", str(ts),
                 "--simplify", "true", "--simplify-error", str(err),
                 # `palette` merges materials that have no texture into one
                 # shared palette material. The hull's paint layers are exactly
                 # that kind of material, so with palette on, every panel colour
                 # we just resolved from the .mtl collapsed into a single
                 # `PaletteMaterial001` covering ~42 % of the Cutlass — the white
                 # blob of feedback d7f44a41. Keep the materials distinct.
                 "--palette", "false",
                 # meshopt, not draco (#305). Both keep the mesh compressed on
                 # disk, so both need a client-side decoder — the difference is
                 # WHERE that decoder comes from. model-viewer hardcodes Draco's
                 # to `https://www.gstatic.com/draco/...` and resets any override
                 # while loading, so a Draco hull cannot be decoded without
                 # reaching Google. Its meshopt decoder is bundled and merely
                 # needs `meshoptDecoderLocation` pointed at a same-origin copy,
                 # which sticks. Measured cost of the swap on the Cutlass hull
                 # through this exact pipeline: 1.97 MB -> 3.09 MB (1.56x), and
                 # the rendered model is dimensionally identical (delta < 1 mm).
                 "--compress", "meshopt"]
        host_argv = os.environ.get("SC_GLTF_TRANSFORM_ARGV")
        if host_argv:
            # Host (Electron) provides the runtime: a JSON argv prefix that runs
            # the bundled @gltf-transform/cli through its OWN Node, so the
            # packaged app needs no global npx/Node. ELECTRON_RUN_AS_NODE makes
            # the Electron binary behave as a plain Node interpreter.
            prefix = _json.loads(host_argv)
            env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
            r = subprocess.run([*prefix, *flags], capture_output=True,
                               encoding="utf-8", errors="replace", timeout=900, env=env)
        else:
            # Dev fallback: pull the CLI on demand via npx (Node required).
            npx = shutil.which("npx") or "npx"
            cmd = [npx, "--yes", "@gltf-transform/cli@latest", *flags]
            # Windows npx is a .CMD shim → must go through the shell with quoting.
            if sys.platform == "win32":
                # npx is a .CMD shim, so this dev-only branch must go through
                # cmd.exe; list2cmdline quoting is NOT a boundary against cmd.exe
                # metacharacter parsing, so refuse hostile paths outright. Prod
                # never reaches here — the packaged app supplies
                # SC_GLTF_TRANSFORM_ARGV and takes the shell-free path above.
                _reject_shell_meta(cmd)
                r = subprocess.run(subprocess.list2cmdline(cmd), shell=True,
                                   capture_output=True, encoding="utf-8",
                                   errors="replace", timeout=900)
            else:
                r = subprocess.run(cmd, capture_output=True, encoding="utf-8",
                                   errors="replace", timeout=900)
        if not out_glb.exists():
            raise RuntimeError(
                f"gltf-transform failed (rc={r.returncode}): {(r.stderr or '')[-400:]}")

    def quality_ladder(self) -> List[tuple]:
        """(texture_size, simplify_error) attempts, best first.

        Step 0 is the configured quality — the vast majority of skins stop there.
        Each further step halves the texture and doubles the simplify error,
        down to MIN_TEXTURE_SIZE.
        """
        steps = [(self.cfg.texture_size, self.cfg.simplify_error)]
        ts, err = self.cfg.texture_size, self.cfg.simplify_error
        while ts > MIN_TEXTURE_SIZE:
            ts //= 2
            err = min(err * 2, MAX_SIMPLIFY_ERROR)
            steps.append((ts, err))
        return steps

    def _optimize_to_budget(self, in_glb: Path, out_glb: Path, skin_id: str) -> int:
        """Optimize, retrying at lower quality while the glb exceeds the budget.

        Returns the final size in bytes. The last ladder step is kept even if it
        is still over budget — a slightly-too-big skin beats no skin at all.
        """
        budget = self.cfg.max_model_bytes
        ladder = self.quality_ladder()
        size = 0
        for i, (ts, err) in enumerate(ladder):
            self._optimize(in_glb, out_glb, ts, err)
            size = out_glb.stat().st_size
            if budget <= 0 or size <= budget:
                return size
            if i == len(ladder) - 1:
                self.log("warn", f"  {skin_id}: {size/1e6:.2f} MB still over the "
                                 f"{budget/1e6:.2f} MB budget at texture {ts} — keeping it")
                return size
            self.log("info", f"  {skin_id}: {size/1e6:.2f} MB over the "
                             f"{budget/1e6:.2f} MB budget — retrying at texture "
                             f"{ladder[i+1][0]}")
        return size

    # ---- public API --------------------------------------------------------
    def export_ship(self, spec: ShipSpec) -> dict:
        """Export one ship: its hull glb + every paint's icon. Returns the catalog.

        The hull hangs off exactly one catalog entry (see `hull_paint`); every
        other paint is listed with its store icon only.
        """
        t0 = time.time()
        safe_id(spec.ship_id, "ship_id")  # flows into filenames + storage paths + cmdline
        ship_out = self.cfg.out_dir / spec.ship_id
        # A rebuild replaces the ship wholesale: textured glbs of an older export
        # and its `.uploaded` marker must not survive next to the new catalog.
        shutil.rmtree(ship_out, ignore_errors=True)
        (ship_out / "models").mkdir(parents=True, exist_ok=True)
        (ship_out / "icons").mkdir(parents=True, exist_ok=True)

        catalog: List[dict] = []
        hull: dict = {}
        try:
            base = hull_paint(spec.paints)
            if base is not None:
                try:
                    hull = self._export_hull(spec, base, ship_out)
                    self.log("info", f"hull via '{base.id}' -> {hull['model']}")
                except Exception as exc:  # noqa: BLE001 — the icons still ship
                    self.log("warn", f"hull via '{base.id}' failed: {type(exc).__name__}: {exc}")
                    hull = {"model": None, "error": str(exc)}
            for paint in spec.paints:
                entry = {"id": paint.id, "name": paint.name,
                         "description": paint.description, "source": paint.source,
                         "name_verified": paint.name_verified, "model": None,
                         "icon": self._export_icon(paint, ship_out) if paint.icon_dds else None}
                if paint is base:
                    entry.update(hull)
                catalog.append(entry)
        finally:
            # always clean scratch, even on an unexpected escape — per-skin mirrors
            # each hold the full mirrored Data subtree + DDS (can be GBs).
            if not self.cfg.keep_work:
                shutil.rmtree(self.cfg.work_dir, ignore_errors=True)

        cat_path = ship_out / "skins.json"
        cat_path.write_text(json.dumps({"ship": spec.ship_id, "format": EXPORT_FORMAT,
                                        "skins": catalog},
                                       indent=2, ensure_ascii=False), encoding="utf-8")
        self.log("info", f"{spec.ship_id}: hull {'ok' if hull.get('model') else 'missing'}, "
                         f"{sum(1 for c in catalog if c.get('icon'))}/{len(catalog)} "
                         f"paint icons in {time.time()-t0:.0f}s")
        return {"ship": spec.ship_id, "skins": catalog, "catalog_path": str(cat_path)}

    def _export_hull(self, spec: ShipSpec, paint: Paint, ship_out: Path) -> dict:
        safe_id(paint.id, "skin_id")  # flows into filenames + storage paths + cmdline
        mirror = self.cfg.work_dir / paint.id
        if mirror.exists():
            shutil.rmtree(mirror, ignore_errors=True)
        try:
            return self._export_hull_inner(spec, paint, ship_out, mirror)
        finally:
            if not self.cfg.keep_work:
                shutil.rmtree(mirror, ignore_errors=True)  # free the mirror's GBs now

    def _export_hull_inner(self, spec: ShipSpec, paint: Paint, ship_out: Path,
                           mirror: Path) -> dict:
        # 1. mesh + mesh-data + paint material into mirrored tree. No DDS is
        # extracted: the output is geometry only.
        cga_disk = self._mirror_save(spec.hull_cga, mirror)
        cgam = spec.hull_cga[:-4] + ".cgam"
        if (self._byname.get(cgam) or self._ddsidx.get(cgam.lower())):
            try:
                self._mirror_save(cgam, mirror)
            except FileNotFoundError:
                pass
        mtl_disk = self._mirror_save(paint.mtl, mirror)
        # 2. convert -> raw glb (-mtl path is relative to the .cga directory)
        import os
        objectdir = mirror / spec.objectdir_anchor
        mtl_rel = os.path.relpath(mtl_disk, cga_disk.parent).replace("\\", "/")
        raw_glb = mirror / f"{spec.ship_id}_{paint.id}.glb"
        self._cgf_to_glb(cga_disk, objectdir, mtl_rel, raw_glb)
        # 3a. un-rig the hull. cgf-converter wraps the .cga node hierarchy in a
        # skin whose every joint matrix is the identity; the glTF spec makes a
        # renderer ignore a skinned node's transform, so <model-viewer> piled
        # every wing/tail/engine onto the origin — the "kaputtes 3D-Modell" of
        # feedback d7f44a41. Deliberately its OWN step and its own try/except:
        # a ship whose paint .mtl will not parse must still get a correctly
        # PLACED hull (white beats collapsed). See HULL3D.md for the numbers.
        self._unrig_hull(paint, raw_glb)
        # 3b. shape only: drop the interior and every texture/UV. NOT
        # best-effort like the un-rig — a hull that still carries CIG's
        # textures must never be published, so a failure here costs the model.
        self._reduce_to_geometry(raw_glb)
        # 4. optimize -> web glb (within the per-model size budget)
        web_glb = ship_out / "models" / f"{spec.ship_id}_{paint.id}.glb"
        size_bytes = self._optimize_to_budget(raw_glb, web_glb, paint.id)
        return {"model": f"models/{web_glb.name}", "model_mb": round(size_bytes / 1e6, 2)}

    def _unrig_hull(self, paint: Paint, raw_glb: Path) -> None:
        """Drop the converter's no-op skin so the hull's parts stay in place.

        Best-effort, like the material pass: a hull we cannot un-rig still ships
        (a mis-placed model beats no model), but the failure is logged — a
        collapsed hull is the exact defect this step exists for.
        """
        try:
            from . import glb_materials
            gltf, binary = glb_materials.read_glb(raw_glb)
            if glb_materials.strip_noop_skins(gltf, binary, self.log)["stripped"]:
                glb_materials.write_glb(raw_glb, gltf, binary)
        except Exception as exc:  # noqa: BLE001 — never lose a model over rigging
            self.log("warn", f"  {paint.id}: un-rigging failed "
                             f"({type(exc).__name__}: {exc}) — hull may render collapsed")

    def _reduce_to_geometry(self, raw_glb: Path) -> None:
        """Interior strip + texture strip; raises instead of shipping textures."""
        from . import glb_materials
        if self.cfg.strip_interior:
            glb_materials.drop_interior_geometry(raw_glb, self.log)
        glb_materials.strip_to_geometry(raw_glb, self.log)

    def _export_icon(self, paint: Paint, ship_out: Path) -> Optional[str]:
        from scdatatools.engine.textures import dds as ddsmod
        from PIL import Image
        info = self._ddsidx.get(paint.icon_dds.lower().split(".dds")[0] + ".dds")
        if not info:
            return None
        try:
            raw = ddsmod.collect_and_unsplit(info)
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
            bg = Image.new("RGBA", img.size, (16, 17, 20, 255))
            bg.alpha_composite(img)
            out = ship_out / "icons" / f"{paint.id}.webp"
            bg.convert("RGB").save(out, "WEBP", quality=90)
            return f"icons/{out.name}"
        except Exception:  # noqa: BLE001
            return None
