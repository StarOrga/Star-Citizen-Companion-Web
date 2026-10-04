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

from . import stage_timing

LogFn = Callable[[str, str], None]

# Adaptive size budget: the simplify errors the retry ladder walks through when
# a hull blows the per-model budget. Step 0 is NO simplification. CIG hulls are
# hundreds of open, overlapping panels, and meshoptimizer tears them into
# see-through cracks long before it saves much: measured on LIVE through this
# pipeline (hole ratio = visible exterior lost vs. the raw mesh, see
# mesh_integrity), simplify 0.002 left 0.31 % / 0.43 % / 1.05 % of the visible
# skin open on the Avenger Stalker / Gladius / Cutlass Black (worst single view
# 2.2 % / 5.8 % / 4.1 %); the old ladder floor 0.01 more still. Every rung is
# gated by the hole check, so the ladder stops at the first error that tears.
SIMPLIFY_LADDER = (0.0, 0.0005, 0.001, 0.002)
MAX_SIMPLIFY_ERROR = SIMPLIFY_LADDER[-1]
MIN_TEXTURE_SIZE = 256

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
    simplify_error: float = 0.0   # first ladder rung; 0 = no simplification
    # Per-model size budget. A hull over budget is re-optimized up the simplify
    # ladder until it fits — but the hole gate stays authoritative: a rung that
    # tears the skin is never kept, so a hull may end up over budget. 1.5 MB
    # since the gap-free export: unsimplified hulls measured 0.44 MB (Avenger
    # Stalker) to 1.44 MB (Gladius) meshopt-compressed. 0 disables the budget.
    max_model_bytes: int = 1_500_000
    # Drop the ship's interior geometry/textures. The Showroom is an exterior
    # viewer; the interior is a quarter of the triangles and the bulk of the
    # texture payload, and is never visible in the viewer.
    strip_interior: bool = True
    # Hole gate (mesh_integrity): refuse a hull whose optimized mesh lost more
    # of the visible exterior than this vs. the raw converter output.
    max_hole_ratio: float = 0.002
    on_log: LogFn = _noop
    keep_work: bool = False       # keep scratch for debugging


# Written into skins.json. A cached ship built by an older pipeline carries no or
# another format and must be rebuilt — `skin_export_app --skip-existing`
# compares against this. geometry-v1: one texture-free hull per ship.
# geometry-v2: + `scenes[scene].extras.hardpoints` (the locators optimize drops).
EXPORT_FORMAT = "geometry-v2"


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
        # Called with (spec, raw_glb) once the raw hull is un-rigged and before
        # anything is stripped from it — the asset package reads its node tree
        # and interior from here instead of converting the hull again.
        self.raw_hook: Optional[Callable[[ShipSpec, Path], None]] = None

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
        with stage_timing.timed("~p4k-read"):
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
        with stage_timing.timed("convert"):
            r = subprocess.run(cmd, cwd=str(cga_disk.parent), capture_output=True, timeout=600)
        # cgf-converter's exit code is unreliable (non-zero on success in some
        # paths), so the freshly-produced output file is the success signal —
        # robust now that any stale glb was unlinked above. rc is logged only.
        if not produced.exists() or produced.stat().st_size < 4096:
            raise RuntimeError(
                f"cgf-converter produced no usable glb for {cga_disk.name} (rc={r.returncode})")
        produced.replace(out_glb)

    def _gltf_transform(self, args: List[str]) -> subprocess.CompletedProcess:
        """Run one @gltf-transform/cli command (bundled Node, or npx in dev)."""
        import json as _json
        import os
        import sys
        host_argv = os.environ.get("SC_GLTF_TRANSFORM_ARGV")
        if host_argv:
            # Host (Electron) provides the runtime: a JSON argv prefix that runs
            # the bundled @gltf-transform/cli through its OWN Node, so the
            # packaged app needs no global npx/Node. ELECTRON_RUN_AS_NODE makes
            # the Electron binary behave as a plain Node interpreter.
            prefix = _json.loads(host_argv)
            env = {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
            worker = self._optimizer_worker(prefix, env)
            if worker is not None:
                from .gltf_worker import WorkerUnavailable
                try:
                    ok, err = worker.run(args)
                    return subprocess.CompletedProcess(args, 0 if ok else 1, "", err)
                except WorkerUnavailable as exc:
                    # Accelerator only: from here on one Node per call, as before.
                    self.log("warn", f"  optimizer worker unavailable ({exc}) — "
                                     "starting one Node per call from here on")
                    self._worker_failed = True
                    worker.close()
            return subprocess.run([*prefix, *args], capture_output=True,
                                  encoding="utf-8", errors="replace", timeout=900, env=env)
        # Dev fallback: pull the CLI on demand via npx (Node required).
        npx = shutil.which("npx") or "npx"
        cmd = [npx, "--yes", "@gltf-transform/cli@latest", *args]
        if sys.platform == "win32":
            # npx is a .CMD shim, so this dev-only branch must go through
            # cmd.exe; list2cmdline quoting is NOT a boundary against cmd.exe
            # metacharacter parsing, so refuse hostile paths outright. Prod
            # never reaches here — the packaged app supplies
            # SC_GLTF_TRANSFORM_ARGV and takes the shell-free path above.
            _reject_shell_meta(cmd)
            return subprocess.run(subprocess.list2cmdline(cmd), shell=True,
                                  capture_output=True, encoding="utf-8",
                                  errors="replace", timeout=900)
        return subprocess.run(cmd, capture_output=True, encoding="utf-8",
                              errors="replace", timeout=900)

    def _optimizer_worker(self, prefix: List[str], env: dict):
        """The shared long-lived optimizer (gltf_worker), or None."""
        from .gltf_worker import GltfWorker, WorkerUnavailable, worker_disabled
        if getattr(self, "_worker_failed", False) or worker_disabled():
            return None
        if getattr(self, "_worker", None) is None:
            try:
                self._worker = GltfWorker(prefix, env)
            except WorkerUnavailable:
                self._worker_failed = True
                return None
        return self._worker

    def _gltf_step(self, args: List[str], out_glb: Path) -> None:
        out_glb.unlink(missing_ok=True)  # never mistake a stale file for success
        with stage_timing.timed(f"gltf {args[0]}"):
            r = self._gltf_transform(args)
        if not out_glb.exists():
            raise RuntimeError(f"gltf-transform {args[0]} failed (rc={r.returncode}): "
                               f"{(r.stderr or '')[-400:]}")

    def optimize(self, in_glb: Path, out_glb: Path,
                 texture_size: Optional[int] = None,
                 simplify_error: Optional[float] = None,
                 compress: bool = True) -> None:
        """raw glb -> web glb: optimize, border-locked simplify, meshopt.

        Public for the asset-package pipeline (assets3d). ``simplify_error`` 0
        skips simplification; ``compress=False`` leaves the mesh uncompressed
        so `mesh_integrity` can read it (it cannot decode meshopt buffers).
        """
        ts = self.cfg.texture_size if texture_size is None else texture_size
        err = self.cfg.simplify_error if simplify_error is None else simplify_error
        stage = out_glb.with_name(out_glb.stem + ".stage.glb")
        self._gltf_step(["optimize", str(in_glb.resolve()), str(stage.resolve()),
                         "--texture-compress", "webp", "--texture-size", str(ts),
                         # Simplification runs as its own step below: only the
                         # `simplify` command can lock the mesh borders.
                         "--simplify", "false",
                         # `palette` merges materials that have no texture into
                         # one shared palette material — it collapsed every
                         # panel colour into one (feedback d7f44a41) and would
                         # merge the hull/glass/glow classes. Keep them distinct.
                         "--palette", "false",
                         "--compress", "false"], stage)
        try:
            if err and err > 0:
                # --lock-border: a hull is hundreds of open panels; an unlocked
                # simplifier pulls their edges apart into see-through seams.
                simp = out_glb.with_name(out_glb.stem + ".simp.glb")
                self._gltf_step(["simplify", str(stage.resolve()), str(simp.resolve()),
                                 "--error", str(err), "--ratio", "0",
                                 "--lock-border", "true"], simp)
                simp.replace(stage)
            if compress:
                self.compress(stage, out_glb)
            else:
                stage.replace(out_glb)
        finally:
            stage.unlink(missing_ok=True)

    # Pre-gate name; the budget tests patch it and older callers borrow it.
    _optimize = optimize

    def compress(self, in_glb: Path, out_glb: Path) -> None:
        """meshopt-compress an uncompressed optimize output.

        meshopt, not draco (#305): model-viewer hardcodes Draco's decoder to
        gstatic.com, while its meshopt decoder is bundled and only needs a
        same-origin `meshoptDecoderLocation`. Lossless apart from quantization
        (measured on the Cutlass: rendered model dimensionally identical).
        """
        self._gltf_step(["meshopt", str(in_glb.resolve()), str(out_glb.resolve())], out_glb)

    def quality_ladder(self) -> List[tuple]:
        """(texture_size, simplify_error) attempts, best first.

        Geometry-only hulls carry no texture, so only the simplify error moves:
        from the configured error up SIMPLIFY_LADDER. Each rung is still
        subject to the hole gate in `_optimize_to_budget`.
        """
        start = self.cfg.simplify_error
        errs = [start] + [e for e in SIMPLIFY_LADDER if e > start]
        return [(self.cfg.texture_size, e) for e in errs]

    def _optimize_to_budget(self, in_glb: Path, out_glb: Path, skin_id: str,
                            hardpoints: Optional[Dict[str, List[float]]] = None,
                            reference=None) -> int:
        """Optimize, retrying with more simplification while over the budget.

        Without a ``reference`` this is the plain size ladder: the last rung is
        kept even if still over budget. With one (raw triangles, see
        `raw_reference`) every rung is measured by `mesh_integrity` before it
        is compressed. A rung that tears the skin ends the ladder — more
        simplification only tears more — and the last rung that passed is kept
        even over budget: a big hull beats a gappy one. If the first rung
        already fails, HullIntegrityError is raised and no hull is exported.
        """
        from . import glb_materials
        budget = self.cfg.max_model_bytes
        ladder = self.quality_ladder()
        size = 0
        kept = out_glb.with_name(out_glb.stem + ".kept.glb")
        have_kept = False
        try:
            for i, (ts, err) in enumerate(ladder):
                if reference is None:
                    self._optimize(in_glb, out_glb, ts, err)
                else:
                    from . import mesh_integrity
                    check = out_glb.with_name(out_glb.stem + ".check.glb")
                    try:
                        self._optimize(in_glb, check, ts, err, compress=False)
                        with stage_timing.timed("hole-gate"):
                            report = mesh_integrity.check_hull(reference, check,
                                                               self.cfg.max_hole_ratio)
                        self.last_integrity = report
                        self.log("info" if report.ok else "warn",
                                 f"  {skin_id}: simplify {err}: {report.summary()}")
                        if not report.ok:
                            if not have_kept:
                                raise mesh_integrity.HullIntegrityError(
                                    f"{skin_id}: exterior has holes — {report.summary()}")
                            kept.replace(out_glb)
                            size = out_glb.stat().st_size
                            self.log("warn", f"  {skin_id}: keeping the last gap-free "
                                             f"attempt ({size/1e6:.2f} MB, over the "
                                             f"{budget/1e6:.2f} MB budget)")
                            return size
                        self.compress(check, out_glb)
                    finally:
                        check.unlink(missing_ok=True)
                if hardpoints:
                    glb_materials.embed_hardpoints(out_glb, hardpoints)
                size = out_glb.stat().st_size
                if budget <= 0 or size <= budget:
                    return size
                if i == len(ladder) - 1:
                    self.log("warn", f"  {skin_id}: {size/1e6:.2f} MB still over the "
                                     f"{budget/1e6:.2f} MB budget at simplify {err} — keeping it")
                    return size
                if reference is not None:
                    shutil.copyfile(out_glb, kept)
                    have_kept = True
                self.log("info", f"  {skin_id}: {size/1e6:.2f} MB over the "
                                 f"{budget/1e6:.2f} MB budget — retrying at simplify "
                                 f"{ladder[i+1][1]}")
            return size
        finally:
            kept.unlink(missing_ok=True)

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
        # 3a'. remember the locator nodes before optimize prunes them (empty
        # nodes do not survive flatten/join/prune). World positions, so they
        # need no hierarchy: optimize flattens but never moves the scene (no
        # --center), and meshopt's quantization only puts a dequantize
        # transform on mesh nodes, which keeps their world placement.
        hardpoints = self._collect_hardpoints(paint, raw_glb)
        if self.raw_hook is not None:
            try:
                self.raw_hook(spec, raw_glb)
            except Exception as exc:  # noqa: BLE001 — the package falls back to converting
                self.log("warn", f"  {paint.id}: raw hull hand-off failed: {type(exc).__name__}: {exc}")
        # 3a''. the hole gate's reference: the raw, unsimplified, unstripped
        # mesh minus the never-drawn proxies, read BEFORE anything is dropped.
        with stage_timing.timed("hole-gate"):
            reference = self.raw_reference(raw_glb)
        # 3b. shape only: drop the interior and every texture/UV. NOT
        # best-effort like the un-rig — a hull that still carries CIG's
        # textures must never be published, so a failure here costs the model.
        self.reduce_to_geometry(raw_glb)
        # 4. optimize -> web glb (within the per-model size budget, hole-gated)
        web_glb = ship_out / "models" / f"{spec.ship_id}_{paint.id}.glb"
        size_bytes = self._optimize_to_budget(raw_glb, web_glb, paint.id, hardpoints,
                                              reference=reference)
        return {"model": f"models/{web_glb.name}", "model_mb": round(size_bytes / 1e6, 2)}

    @staticmethod
    def raw_reference(raw_glb: Path):
        """World-space triangles (numpy ``(N, 3, 3)``) of a raw converter glb,
        proxies excluded: the reference `mesh_integrity.check_hull` measures an
        optimized glb against. Public for the asset-package pipeline."""
        from . import mesh_integrity
        return mesh_integrity.load_triangles(raw_glb, mesh_integrity.visible_reference_filter)

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

    def _collect_hardpoints(self, paint: Paint, raw_glb: Path) -> Dict[str, List[float]]:
        """Locator world positions; best-effort — a hull without them still ships."""
        try:
            from . import glb_materials
            gltf, _ = glb_materials.read_glb(raw_glb)
            hardpoints = glb_materials.collect_hardpoints(gltf)
            self.log("info", f"  {paint.id}: {len(hardpoints)} hardpoint locator(s)")
            return hardpoints
        except Exception as exc:  # noqa: BLE001 — never lose a model over locators
            self.log("warn", f"  {paint.id}: reading hardpoints failed "
                             f"({type(exc).__name__}: {exc}) — model ships without them")
            return {}

    def reduce_to_geometry(self, raw_glb: Path, strip_interior: Optional[bool] = None) -> None:
        """Interior strip + texture strip; raises instead of shipping textures.

        The interior strip only drops interior-named geometry that no outside
        view can see (`drop_interior_geometry(keep_visible=True)`). Pass
        ``strip_interior=False`` for an interior part.
        """
        from . import glb_materials
        if self.cfg.strip_interior if strip_interior is None else strip_interior:
            with stage_timing.timed("interior-scan"):
                glb_materials.drop_interior_geometry(raw_glb, self.log)
        glb_materials.strip_to_geometry(raw_glb, self.log)

    _reduce_to_geometry = reduce_to_geometry

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
