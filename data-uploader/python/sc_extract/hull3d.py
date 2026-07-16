"""3D hull + skin export: turn a ship's CryEngine geometry and paint materials
from the P4K into web-ready, textured glTF (one glb per skin) — 100% from the
P4K, no external data sources.

Pipeline (per ship, per skin):
    p4k  -> .cga + .cgam + paint .mtl + referenced DDS  (scdatatools, unsplit)
         -> cgf-converter (-embedtextures)              -> textured glb
         -> gltf-transform optimize (simplify+webp+draco)-> web glb (~3 MB)

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
    texture_size: int = 1024
    simplify_error: float = 0.002
    # Per-model size budget. A skin over budget is re-optimized down the quality
    # ladder (halve textures, coarsen simplify) until it fits — so only the heavy
    # skins lose fidelity, not the whole catalog. 0 disables the budget.
    max_model_bytes: int = 1_000_000
    on_log: LogFn = _noop
    keep_work: bool = False       # keep scratch for debugging


class Hull3DExporter:
    """Builds web-ready textured glbs (one per skin) + a skin catalog."""

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
        dest = root / p4k_path.replace("\\", "/")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(self._read(p4k_path))
        return dest

    def _extract_mtl_textures(self, mtl_path: str, root: Path) -> int:
        """Decode every DDS a .mtl references into the mirrored Data/ tree."""
        from scdatatools.engine.textures import dds as ddsmod
        from scdatatools.engine.chunkfile import etree_from_cryxml_file

        raw = self._read(mtl_path)
        tree = etree_from_cryxml_file(io.BytesIO(raw))
        refs = set()
        for el in tree.getroot().iter("Texture"):
            f = (el.get("File") or el.get("file") or "").replace("\\", "/")
            if f:
                refs.add(f)
        ok = 0
        for ref in sorted(refs):
            rel = ref[:-4] if ref.lower().endswith((".tif", ".dds", ".png")) else ref
            info = self._ddsidx.get(("data/" + rel + ".dds").lower())
            if not info:
                continue
            try:
                out = root / "Data" / (rel + ".dds")
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(ddsmod.collect_and_unsplit(info))
                ok += 1
            except Exception:  # noqa: BLE001 — best-effort per texture
                pass
        return ok

    # ---- build tools -------------------------------------------------------
    def _cgf_to_glb(self, cga_disk: Path, objectdir: Path, mtl_rel: Optional[str],
                    out_glb: Path) -> None:
        produced = cga_disk.with_suffix(".glb")
        produced.unlink(missing_ok=True)  # never mistake a stale glb for success
        cmd = [str(self.cfg.cgf_converter), cga_disk.name, "-glb", "-embedtextures",
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
                 "--compress", "draco"]
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
        """Export one ship: a web glb per skin + a skin catalog. Returns the catalog."""
        t0 = time.time()
        safe_id(spec.ship_id, "ship_id")  # flows into filenames + storage paths + cmdline
        ship_out = self.cfg.out_dir / spec.ship_id
        (ship_out / "models").mkdir(parents=True, exist_ok=True)
        (ship_out / "icons").mkdir(parents=True, exist_ok=True)

        catalog: List[dict] = []
        try:
            for paint in spec.paints:
                try:
                    entry = self._export_skin(spec, paint, ship_out)
                    catalog.append(entry)
                    self.log("info", f"skin '{paint.id}' -> {entry.get('model')}")
                except Exception as exc:  # noqa: BLE001 — one bad skin must not kill the run
                    self.log("warn", f"skin '{paint.id}' failed: {type(exc).__name__}: {exc}")
                    catalog.append({"id": paint.id, "name": paint.name, "model": None,
                                    "error": str(exc)})
        finally:
            # always clean scratch, even on an unexpected escape — per-skin mirrors
            # each hold the full mirrored Data subtree + DDS (can be GBs).
            if not self.cfg.keep_work:
                shutil.rmtree(self.cfg.work_dir, ignore_errors=True)

        cat_path = ship_out / "skins.json"
        cat_path.write_text(json.dumps({"ship": spec.ship_id, "skins": catalog},
                                       indent=2, ensure_ascii=False), encoding="utf-8")
        self.log("info", f"{spec.ship_id}: {sum(1 for c in catalog if c.get('model'))}/"
                         f"{len(catalog)} skins in {time.time()-t0:.0f}s")
        return {"ship": spec.ship_id, "skins": catalog, "catalog_path": str(cat_path)}

    def _export_skin(self, spec: ShipSpec, paint: Paint, ship_out: Path) -> dict:
        safe_id(paint.id, "skin_id")  # flows into filenames + storage paths + cmdline
        mirror = self.cfg.work_dir / paint.id
        if mirror.exists():
            shutil.rmtree(mirror, ignore_errors=True)
        try:
            return self._export_skin_inner(spec, paint, ship_out, mirror)
        finally:
            if not self.cfg.keep_work:
                shutil.rmtree(mirror, ignore_errors=True)  # free this skin's GBs now

    def _export_skin_inner(self, spec: ShipSpec, paint: Paint, ship_out: Path,
                           mirror: Path) -> dict:
        # 1. mesh + mesh-data + paint material into mirrored tree
        cga_disk = self._mirror_save(spec.hull_cga, mirror)
        cgam = spec.hull_cga[:-4] + ".cgam"
        if (self._byname.get(cgam) or self._ddsidx.get(cgam.lower())):
            try:
                self._mirror_save(cgam, mirror)
            except FileNotFoundError:
                pass
        mtl_disk = self._mirror_save(paint.mtl, mirror)
        # 2. textures referenced by this paint
        n = self._extract_mtl_textures(paint.mtl, mirror)
        self.log("info", f"  {paint.id}: {n} textures")
        # 3. convert -> textured glb (-mtl path is relative to the .cga directory)
        import os
        objectdir = mirror / spec.objectdir_anchor
        mtl_rel = os.path.relpath(mtl_disk, cga_disk.parent).replace("\\", "/")
        raw_glb = mirror / f"{spec.ship_id}_{paint.id}.glb"
        self._cgf_to_glb(cga_disk, objectdir, mtl_rel, raw_glb)
        # 4. optimize -> web glb (within the per-model size budget)
        web_glb = ship_out / "models" / f"{spec.ship_id}_{paint.id}.glb"
        size_bytes = self._optimize_to_budget(raw_glb, web_glb, paint.id)
        # 5. icon
        icon_rel = None
        if paint.icon_dds:
            icon_rel = self._export_icon(paint, ship_out)
        size_mb = size_bytes / 1e6
        return {"id": paint.id, "name": paint.name, "description": paint.description,
                "source": paint.source, "name_verified": paint.name_verified,
                "model": f"models/{web_glb.name}", "model_mb": round(size_mb, 2),
                "icon": icon_rel}

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
