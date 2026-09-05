"""Ship-agnostic auto-discovery of hull geometry + paint liveries from the P4K.

Builds a `hull3d.ShipSpec` for ANY ship by pattern-matching P4K conventions —
no hard-coded per-ship paths. The paint LIST comes from the authoritative
sources (store-icons in PaintColorLogos + Localization names); the paint .mtl
(needed for the textured 3D) is matched best-effort. A paint with an icon+name
but no resolvable .mtl still appears in the catalog (icon preview, no 3D).

Conventions used (verified across Cutlass / Gladius / Hornet / Freelancer):
  hull mesh   Data/Objects/Spaceships/Ships/<MFR>/<Ship>/<ShipId>.cga   (largest)
  paint mtls  .../<Ship>/**/*.mtl  (paint-like names, not _ext/_int/sub-parts)
  icons       Data/UI/SharedAssets/PaintColorLogos/Paint_<token>_*_Icon.dds
  names       Data/Localization/english/global.ini  item_Name<Series>_Paint_<key>
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional

from .hull3d import Paint, ShipSpec

SHIPS_ROOT = "Data/Objects/Spaceships/Ships"
ICON_DIR = "Data/UI/SharedAssets/PaintColorLogos"

# mtl name tokens that are sub-parts / states, never a sellable livery
_NON_PAINT = ("_ext", "_int", "_interior", "_exterior", "_damaged", "_derelict",
              "_glass", "_canopy", "_cockpit", "_shell", "_armor", "_decal",
              "_lod", "_dmg", "_emissive", "_window")


def _sz(i) -> int:
    return getattr(i, "file_size", 0) or 0


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


@dataclass
class ShipRef:
    """Minimal identity for a ship in the P4K."""
    ship_id: str        # e.g. "DRAK_Cutlass_Black"
    mfr: str            # "DRAK"
    ship: str           # ship folder, e.g. "Cutlass"
    series_token: str   # icon/localization token, e.g. "Cutlass"


class ShipDiscovery:
    def __init__(self, p4k) -> None:
        self.p4k = p4k
        self.infos = p4k.infolist()
        self._lower = {i.filename.lower().replace("\\", "/"): i for i in self.infos}
        self._loc_names: Dict[str, str] = {}
        self._loc_descs: Dict[str, str] = {}
        self._loc_loaded = False
        # Optional pre-built candidate buckets so a per-ship catalog lookup is
        # O(paints) instead of O(archive entries). Populated by build_index();
        # when absent the methods fall back to a full self.infos scan (fine for
        # the single-ship CLI / unit tests, catastrophic for a whole-catalog run).
        self._indexed = False
        self._icons_index: Dict[str, List] = {}   # series token -> [icon infos]
        self._mtls_index: Dict[str, List] = {}     # "mfr/ship"    -> [mtl infos]

    # ---- index (whole-catalog fast path) ----------------------------------
    def build_index(self) -> None:
        """One pass over the archive: bucket paint icons by series token and
        ship materials by MFR/Ship folder. Turns the per-ship icon/material
        scans from O(entries) into O(1) lookups — required when discovering
        skins for every ship in a single extract run."""
        if self._indexed:
            return
        root = SHIPS_ROOT.lower() + "/"
        for i in self.infos:
            fn = i.filename.lower().replace("\\", "/")
            if "/paintcolorlogos/" in fn and fn.endswith(".dds") and ".dds." not in fn:
                stem = Path(fn).stem
                if stem.startswith("paint_"):
                    series = stem[len("paint_"):].split("_", 1)[0]
                    self._icons_index.setdefault(series, []).append(i)
            elif fn.startswith(root) and fn.endswith(".mtl"):
                parts = fn[len(root):].split("/")
                if len(parts) >= 2:
                    self._mtls_index.setdefault(f"{parts[0]}/{parts[1]}", []).append(i)
        self._indexed = True

    # ---- localization -----------------------------------------------------
    def _load_loc(self) -> None:
        if self._loc_loaded:
            return
        self._loc_loaded = True
        info = self._lower.get("data/localization/english/global.ini")
        if not info:
            return
        text = self.p4k.open(info).read().decode("utf-8-sig", errors="replace")
        for ln in text.splitlines():
            if "=" not in ln:
                continue
            k, v = ln.split("=", 1)
            m = re.match(r"item_Name(.+?)_Paint_(.+)", k)
            if m:
                self._loc_names[f"{m.group(1)}|{m.group(2)}".lower()] = v.strip()
            m = re.match(r"item_Desc(.+?)_Paint_(.+)", k)
            if m:
                self._loc_descs[f"{m.group(1)}|{m.group(2)}".lower()] = v.strip()

    # ---- discovery --------------------------------------------------------
    def find_hull(self, ref: ShipRef) -> Optional[str]:
        """The whole-ship render mesh: exact <ShipId>.cga, else largest ship .cga."""
        base = f"{SHIPS_ROOT}/{ref.mfr}/{ref.ship}".lower()
        exact = self._lower.get(f"{base}/{ref.ship_id}.cga".lower())
        if exact:
            return exact.filename
        cands = [i for i in self.infos
                 if i.filename.lower().replace("\\", "/").startswith(base + "/")
                 and i.filename.lower().endswith(".cga")
                 and "_lod" not in i.filename.lower()
                 and not any(t in i.filename.lower() for t in ("_cinematic", "_destruct"))]
        cands.sort(key=_sz, reverse=True)
        return cands[0].filename if cands else None

    def _ship_mtls(self, ref: ShipRef) -> List[str]:
        base = f"{SHIPS_ROOT}/{ref.mfr}/{ref.ship}".lower()
        src = self._mtls_index.get(f"{ref.mfr}/{ref.ship}".lower(), []) if self._indexed else self.infos
        out = []
        for i in src:
            fn = i.filename.lower().replace("\\", "/")
            if fn.startswith(base + "/") and fn.endswith(".mtl"):
                name = Path(fn).stem
                if any(t in name for t in _NON_PAINT):
                    continue
                out.append(i.filename)
        return out

    # other-variant markers — a Black ship must not pick up Blue/Red/Steel paints
    _VARIANTS = ("black", "blue", "red", "steel", "pirate", "ghost")

    def _variant_of(self, ship_id: str) -> Optional[str]:
        low = ship_id.lower()
        for v in self._VARIANTS:
            if f"_{v}" in low or low.endswith(v):
                return v
        return None

    def find_paint_icons(self, ref: ShipRef) -> Dict[str, str]:
        """token -> icon path. Filtered to this ship's variant: keep tokens that
        carry the ship's own variant marker (e.g. 'black') or carry NO foreign
        variant marker (series-generic event paints)."""
        pref = f"paint_{ref.series_token.lower()}_"
        my_var = self._variant_of(ref.ship_id)
        src = self._icons_index.get(ref.series_token.lower(), []) if self._indexed else self.infos
        out = {}
        for i in src:
            fn = i.filename.lower().replace("\\", "/")
            if "/paintcolorlogos/" not in fn or not fn.endswith(".dds") or ".dds." in fn:
                continue
            stem = Path(fn).stem
            if not stem.startswith(pref):
                continue
            tok = stem[len("paint_"):].rsplit("_icon", 1)[0]
            tok_vars = [v for v in self._VARIANTS if f"_{v}" in f"_{tok}_"]
            if tok_vars:
                if my_var and my_var not in tok_vars:
                    continue          # foreign variant (e.g. steel paint on a black ship)
                if not my_var:
                    continue          # variant-specific paint but ship has no variant
            out[tok] = i.filename
        return out

    def _match_mtl(self, icon_tok: str, mtls: List[str], ref: ShipRef) -> Optional[str]:
        """Strict: require the distinctive token (icon token minus ship/variant
        words) to appear as a contiguous slug inside the .mtl stem. No fuzzy
        guesses — a wrong material is worse than none."""
        stop = {ref.series_token.lower(), ref.mfr.lower(), self._variant_of(ref.ship_id) or "",
                "camo", "livery", "paint", "grey", "gray", "metal", ""}
        distinctive = [w for w in _slug(icon_tok).split("_") if w not in stop]
        if not distinctive:
            return None
        needle = "_".join(distinctive)
        my_var = self._variant_of(ref.ship_id)
        best = None
        for m in mtls:
            stem = _slug(Path(m).stem)
            # respect ship variant in the mtl too
            mtl_vars = [v for v in self._VARIANTS if f"_{v}" in f"_{stem}_"]
            if mtl_vars and my_var and my_var not in mtl_vars:
                continue
            if needle in stem or all(w in stem.split("_") for w in distinctive):
                # prefer the shortest matching stem (most specific)
                if best is None or len(stem) < len(_slug(Path(best).stem)):
                    best = m
        return best

    def _loc_lookup(self, series: str, icon_tok: str) -> tuple[Optional[str], str]:
        """Resolve the official name by matching the icon's distinctive words
        against the localized display NAME (value), not the internal key — the
        store name (e.g. 'Coalfire') is the bridge, the key ('Fleetweek_2021_…')
        is not."""
        self._load_loc()
        _FILLER = {series.lower(), "camo", "grey", "gray", "livery", "metal", "black",
                   "white", "red", "blue", "green", "steel", "gold", "yellow", "orange",
                   "turquoise", "light", "dark", "digi"}
        words = [w for w in _slug(icon_tok).split("_") if w and w not in _FILLER]
        best_key, best = None, 0.0
        for key, name in self._loc_names.items():
            s, _pk = key.split("|", 1)
            if s != series.lower():
                continue
            nslug = _slug(name)
            # fraction of the icon's distinctive words that appear in the name
            hit = sum(1 for w in words if w and w in nslug.split("_"))
            score = hit / max(1, len(words))
            if score > best:
                best_key, best = key, score
        if best_key and best >= 0.5:
            return self._loc_names[best_key], self._loc_descs.get(best_key, "")
        return None, ""

    def find_base_mtl(self, ref: ShipRef, mtls: List[str], hull_cga: str = "") -> Optional[str]:
        """The ship's factory-finish .mtl.

        Exact `<ShipId>.mtl` is the convention and wins. It is NOT universal
        though — plenty of hulls name the base material after the *folder* or
        after the mesh rather than the entity id, and a ship whose base material
        we fail to resolve produces no `standard` livery at all, which used to
        drop the whole ship out of a catalog-wide build. So fall back, in order:
        the .mtl sitting next to the hull mesh with the mesh's own stem, then the
        shortest remaining candidate (the base name is always a prefix of its
        `_pirate` / `_camo_digi` livery siblings).
        """
        by_stem = {Path(m).stem.lower(): m for m in mtls}
        exact = by_stem.get(ref.ship_id.lower())
        if exact:
            return exact
        if hull_cga:
            mesh_stem = Path(hull_cga.replace("\\", "/")).stem.lower()
            sibling = by_stem.get(mesh_stem)
            if sibling:
                return sibling
        if not mtls:
            return None
        return min(mtls, key=lambda m: (len(Path(m).stem), m.lower()))

    def discover(self, ref: ShipRef) -> ShipSpec:
        hull = self.find_hull(ref)
        mtls = self._ship_mtls(ref)
        icons = self.find_paint_icons(ref)
        paints: List[Paint] = []

        # standard paint = the base hull .mtl (no paint suffix), if resolvable
        std_mtl = self.find_base_mtl(ref, mtls, hull or "")
        if std_mtl:
            paints.append(Paint(mtl=std_mtl, id="standard",
                                name=f"{ref.ship.replace('_',' ')} (Standard)",
                                description="Factory-standard finish.",
                                source="factory"))

        for tok, icon in sorted(icons.items()):
            name, desc = self._loc_lookup(ref.series_token, tok)
            mtl = self._match_mtl(tok, mtls, ref)
            paints.append(Paint(
                mtl=mtl or "", id=_slug(tok),
                name=name or f"{ref.series_token} {tok.replace('_',' ').title()}",
                description=desc, icon_dds=icon,
                source="store" if name else "event",
                name_verified=bool(name),
            ))

        return ShipSpec(
            ship_id=ref.ship_id,
            hull_cga=hull or "",
            objectdir_anchor="Data",
            paints=[p for p in paints if p.mtl or p.icon_dds],
        )

    def catalog(self, ref: ShipRef, hull_cga: str = "") -> List[Dict[str, str]]:
        """Cheap paint catalog (no 3D build) for a ship — the metadata-extract
        counterpart to discover(). Same icon/name/material heuristics, but the
        caller supplies the hull path (already resolved during projection) and
        gets plain catalog dicts back. ``has_material`` flags which paints could
        additionally be built into a textured 3D glb later.

        ``has_material`` is the ONLY thing the build manifest gates on, so it has
        to mean what :meth:`discover` will actually do (#512). It used to read
        ``std_mtl or hull_cga`` for the factory finish, which is true for any ref
        that got this far — so every entity with a hull under the ships root
        entered the manifest, wrecks and salvageable debris included. A catalog
        build then ran 11 h over 309 ships and produced glbs for 21.
        """
        mtls = self._ship_mtls(ref)
        icons = self.find_paint_icons(ref)
        std_mtl = self.find_base_mtl(ref, mtls, hull_cga)

        out: List[Dict[str, str]] = []
        # Every flyable hull has its factory finish — list it as the base livery.
        out.append({
            "id": "standard",
            "name": f"{ref.ship.replace('_', ' ')} (Standard)",
            "description": "Factory-standard finish.",
            "source": "factory",
            "name_verified": False,
            # Mirrors discover(): the standard paint exists only when a base
            # .mtl resolves. find_base_mtl() falls back all the way to the
            # shortest candidate, so None here means the ref has NO materials at
            # all — nothing for the exporter to texture, whatever the hull says.
            "has_material": bool(std_mtl),
            "icon": None,
        })
        for tok, icon in sorted(icons.items()):
            name, desc = self._loc_lookup(ref.series_token, tok)
            mtl = self._match_mtl(tok, mtls, ref)
            out.append({
                "id": _slug(tok),
                "name": name or f"{ref.series_token} {tok.replace('_', ' ').title()}",
                "description": desc,
                "source": "store" if name else "event",
                "name_verified": bool(name),
                "has_material": bool(mtl),
                "icon": icon,
            })
        return out


def ref_from_hull(ship_id: str, hull_path: str) -> Optional[ShipRef]:
    """Build a ShipRef from a resolved hull mesh path
    (``Data/Objects/Spaceships/Ships/<MFR>/<Ship>/...``). The series token —
    used for the ``Paint_<series>_`` icon prefix and the
    ``item_Name<series>_Paint_`` localization keys — defaults to the ship folder,
    which matches the P4K convention for every ship verified so far. Returns
    None when the path is not under the ships root (e.g. ground vehicles)."""
    if not hull_path:
        return None
    low = hull_path.replace("\\", "/").lower()
    marker = SHIPS_ROOT.lower() + "/"
    idx = low.find(marker)
    if idx == -1:
        return None
    rest = hull_path.replace("\\", "/")[idx + len(marker):].split("/")
    if len(rest) < 2:
        return None
    mfr, ship = rest[0], rest[1]
    return ShipRef(ship_id=ship_id, mfr=mfr, ship=ship, series_token=ship)
