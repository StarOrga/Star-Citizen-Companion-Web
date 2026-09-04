"""Hull mass must come from the VEHICLE ROOT part, never from "whatever part
carried a mass first" (§P.2).

The old rule was `named_mass if named_mass is not None else first_mass`, with
`first_mass` taken in document order over a flat `root.iter("Part")` walk. That
is correct for a well-formed single-root XML and wrong for two shapes the LIVE
files actually contain:

  * a VARIANT reuses the base hull's XML (Idris-P -> `aegs_idris.xml`, root part
    "AEGS_Idris"), so the class-name match misses — and any sub-part that
    happens to be listed before the root would win;
  * a file with SEVERAL top-level parts, where document order is arbitrary.

The rule now is: the class-name match first, then the shallowest part (the
vehicle root) and the heaviest of those if several share that depth, with a
`warn` log naming the fallback. A wing is never the hull.
"""

from __future__ import annotations

from test_ship_hull_cargo import _extractor, _vcp  # type: ignore[import-not-found]

# A variant XML whose root part is named after the BASE ship and whose sub-parts
# are listed with masses of their own — the shape the old rule mis-read.
IDRIS_P_XML = b"""<?xml version="1.0"?>
<Vehicle name="AEGS_Idris">
  <Parts>
    <Part name="AEGS_Idris" class="Animated" mass="37854373">
      <Parts>
        <Part name="wing_left" class="AnimatedJoint" mass="120000" damageMax="90000"/>
        <Part name="Body" class="AnimatedJoint" mass="240000" damageMax="1500000"/>
      </Parts>
    </Part>
  </Parts>
</Vehicle>
"""

# Two top-level parts, neither named after the class: the heavier one is the hull.
TWO_ROOTS_XML = b"""<?xml version="1.0"?>
<Vehicle name="ORIG_890Jump">
  <Parts>
    <Part name="hull_aft" class="Animated" mass="900000" damageMax="1000"/>
    <Part name="hull_main" class="Animated" mass="4500000" damageMax="2000"/>
  </Parts>
</Vehicle>
"""

_PATH = "scripts/entities/vehicles/implementations/xml/aegs_idris.xml"
_FULL = "Data/scripts/entities/vehicles/implementations/xml/aegs_idris.xml"


def _with_log(files: dict):
    ex = _extractor(files)
    logs: list = []
    ex.on_log = lambda lvl, m: logs.append((lvl, m))
    return ex, logs


def test_variant_takes_the_root_part_not_a_sub_part() -> None:
    ex, logs = _with_log({_FULL: IDRIS_P_XML})
    hull = ex._hull_stats(_vcp(_PATH), "AEGS_Idris_P")
    assert hull["mass"] == 37854373.0
    assert hull["hp"] == 1590000.0
    assert any(lvl == "warn" and "hull mass" in m for lvl, m in logs)


def test_exact_class_name_match_wins_and_logs_nothing() -> None:
    ex, logs = _with_log({_FULL: IDRIS_P_XML})
    hull = ex._hull_stats(_vcp(_PATH), "AEGS_Idris")
    assert hull["mass"] == 37854373.0
    assert logs == []


def test_several_top_level_parts_pick_the_heaviest_root() -> None:
    ex, logs = _with_log({_FULL: TWO_ROOTS_XML})
    hull = ex._hull_stats(_vcp(_PATH), "ORIG_890Jump")
    assert hull["mass"] == 4500000.0
    assert any(lvl == "warn" for lvl, _ in logs)


def test_no_mass_anywhere_stays_none() -> None:
    ex, _ = _with_log(
        {_FULL: b'<?xml version="1.0"?><Vehicle><Parts>'
                b'<Part name="body" damageMax="10"/></Parts></Vehicle>'}
    )
    hull = ex._hull_stats(_vcp(_PATH), "X")
    assert hull["mass"] is None
    assert hull["hp"] == 10.0
