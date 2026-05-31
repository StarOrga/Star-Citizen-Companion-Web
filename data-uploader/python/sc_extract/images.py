"""Preview images: convert P4K ``.dds`` icon art to small WebP files.

The P4K ships usable 2D art under ``Data/UI/Textures/EA/`` — per-chassis ship
silhouettes (``VehicleIcons``), FPS-weapon icons (``LoadoutIcons``), plus
manufacturer emblems. An entity references its art via
``StaticEntityClassData[].displayIcon`` (a ``.tif`` path that the P4K stores as
``.dds``). Pillow 11 decodes the DXT1/3/5 DDS natively — no texconv binary.

We deduplicate by source path (variants share one icon) and emit only the
files actually referenced, so the cloud stores just the final used art.
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Callable, Dict, Optional

# Output quality. Bumped from 512px/q82 -> 1024px/q90 so the catalog can show
# crisp icon art on hi-DPI displays without re-extracting. DDS sources are
# typically 256-1024px, so 1024 is a no-upscale ceiling (thumbnail() never
# enlarges). q90 + method=6 keeps WebP files small while removing the visible
# block artefacts q82 left on gradients.
_MAX_SIZE = 1024  # longest edge of the emitted WebP
_WEBP_QUALITY = 90

# Optional higher-res "render" preview. Some entities reference a larger render
# texture (e.g. a holo/marketing render) in addition to the small displayIcon.
# When such a source exists IN THE P4K we can emit it at this size. We never
# fetch renders from external URLs — project policy: images come only from the
# P4K (CLAUDE.md: third-party data only via proxy; the same "nothing leaves the
# P4K" rule applies to art assets).
_RENDER_MAX_SIZE = 2048


def normalize_icon_path(display_icon: Optional[str]) -> Optional[str]:
    """``displayIcon`` (e.g. 'UI/Textures/.../X.tif') -> P4K dds entry key."""
    if not display_icon:
        return None
    p = display_icon.replace("\\", "/").strip().lstrip("/")
    if not p:
        return None
    # the source references .tif/.dds/.png; the P4K stores .dds
    for ext in (".tif", ".tiff", ".png", ".dds"):
        if p.lower().endswith(ext):
            p = p[: -len(ext)] + ".dds"
            break
    else:
        return None
    if not p.lower().startswith("data/"):
        p = "Data/" + p
    return p


def _safe_stem(p4k_key: str) -> str:
    stem = Path(p4k_key).stem
    keep = "".join(c if (c.isalnum() or c in "._-") else "_" for c in stem)
    return keep[:120] or "icon"


class AssetExtractor:
    """Converts referenced ``.dds`` icons to deduped WebP files on disk.

    ``resolve(display_icon)`` returns the emitted WebP filename (relative to the
    previews dir) or ``None`` if the art is missing/unconvertible. Caches by
    source path so each unique icon is read + converted at most once.
    """

    def __init__(self, p4k, previews_dir: Path,
                 on_log: Callable[[str, str], None] = lambda lvl, m: None) -> None:
        self.p4k = p4k
        self.dir = previews_dir
        self.on_log = on_log
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lower = {n.lower(): n for n in p4k.namelist()}
        self._cache: Dict[str, Optional[str]] = {}  # p4k_key -> webp filename|None
        self.converted = 0
        self.misses = 0

    def resolve(self, display_icon: Optional[str]) -> Optional[str]:
        key = normalize_icon_path(display_icon)
        if not key:
            return None
        if key in self._cache:
            return self._cache[key]
        result = self._convert(key, _MAX_SIZE)
        self._cache[key] = result
        return result

    def resolve_render(self, render_path: Optional[str]) -> Optional[str]:
        """Convert a higher-res "render"/marketing preview DDS to WebP.

        Documented hook for callers that have discovered a larger render texture
        path ON AN ENTITY (e.g. a holo-render or marketing still) in addition to
        the small displayIcon. Emits at ``_RENDER_MAX_SIZE`` with a ``__render``
        suffix so it never collides with the icon WebP.

        IMPORTANT (project policy): ``render_path`` must be a P4K entry key — the
        same normalization as icons. We never accept or fetch an external URL;
        images must come only from the P4K. If no such source exists on the
        entity, the caller passes ``None`` and this returns ``None`` (the small
        icon remains the usable art).

        # TODO(phase2-verify): confirm the live field that carries a render path
        # (candidates seen in other SC tooling: a second StaticEntityClassData
        # entry, or an SCItemPurchasableParams "marketing" texture). Until a real
        # P4K confirms the field name, dataforge_extract passes None here, so this
        # path is dormant-but-ready rather than guessing a key.
        """
        key = normalize_icon_path(render_path)
        if not key:
            return None
        cache_key = f"render::{key}"
        if cache_key in self._cache:
            return self._cache[cache_key]
        result = self._convert(key, _RENDER_MAX_SIZE, suffix="__render")
        self._cache[cache_key] = result
        return result

    def _convert(self, p4k_key: str, max_size: int, suffix: str = "") -> Optional[str]:
        real = self._lower.get(p4k_key.lower())
        if not real:
            self.misses += 1
            return None
        try:
            from PIL import Image
        except ImportError:
            self.on_log("warn", "Pillow not installed — preview images skipped")
            return None
        out_name = f"{_safe_stem(p4k_key)}{suffix}.webp"
        out_path = self.dir / out_name
        if out_path.exists():
            return out_name
        try:
            with self.p4k.open(self.p4k.getinfo(real)) as f:
                raw = f.read()
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
            # thumbnail() only ever shrinks — a smaller-than-max source is kept
            # at native resolution (no blurry upscale).
            img.thumbnail((max_size, max_size), Image.LANCZOS)
            img.save(out_path, "WEBP", quality=_WEBP_QUALITY, method=6)
            self.converted += 1
            return out_name
        except Exception as exc:  # noqa: BLE001 — best-effort, never abort extract
            self.on_log("warn", f"icon convert failed {real}: {exc}")
            return None
