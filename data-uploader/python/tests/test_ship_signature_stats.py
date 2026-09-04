"""Ship-level `stats` block (PR A task 1): whitelist-only projection of
SSCSignatureSystemParams onto ships. `_project_ship()` previously never called
any stats projection at all — ships got no `stats` key whatsoever.

`_ship_stats()` is deliberately an ALLOWLIST (unlike `_component_stats()`'s
blacklist): a ship's Components list is much larger/noisier than an item's, so
"everything not skipped" would balloon every ship payload. These tests pin
that only the whitelisted struct(s) surface, non-whitelisted structs never do,
and an empty match yields no `stats` key at all (never `{}`).
"""

from __future__ import annotations

from sc_extract.dataforge_extract import CodexExtractor


def _comp(type_name: str, **fields) -> dict:
    return {"_Type_": type_name, **fields}


def _extractor() -> CodexExtractor:
    """Bypass __init__ (needs a real DataForge/Localizer) — _ship_stats() is a
    pure function of `self._SHIP_STATS_WHITELIST` + its `comps` argument."""
    return CodexExtractor.__new__(CodexExtractor)


def test_whitelist_is_signature_only_for_now() -> None:
    assert CodexExtractor._SHIP_STATS_WHITELIST == {"SSCSignatureSystemParams"}


def test_ship_stats_projects_whitelisted_struct() -> None:
    comps = [
        _comp("SSCSignatureSystemParams", signalInfrared=1.0, signalElectromagnetic=0.8),
    ]
    stats = _extractor()._ship_stats(comps)
    assert stats == {
        "SSCSignatureSystemParams": {
            "signalInfrared": 1.0,
            "signalElectromagnetic": 0.8,
        }
    }


def test_ship_stats_flattens_one_nested_level() -> None:
    comps = [
        _comp(
            "SSCSignatureSystemParams",
            signalInfrared=1.0,
            radarProperties={"_Type_": "SRadarProps", "baseSignatureParams": None, "range": 5.0},
        ),
    ]
    stats = _extractor()._ship_stats(comps)
    assert stats["SSCSignatureSystemParams"]["signalInfrared"] == 1.0
    assert stats["SSCSignatureSystemParams"]["radarProperties.range"] == 5.0
    # a nested None is a scalar (not dict/list) so it's kept, matching
    # _component_stats' semantics of "carries a value" including explicit null
    assert stats["SSCSignatureSystemParams"]["radarProperties.baseSignatureParams"] is None


def test_ship_stats_ignores_non_whitelisted_structs() -> None:
    """A ship carrying a big, scalar-rich component OTHER than the whitelisted
    struct must NOT surface it — this is the point of an allowlist over the
    item/component blacklist."""
    comps = [
        _comp("VehicleComponentParams", crewSize=1, vehicleHullDamageNormalizationValue=2.0),
        _comp("SEntityPhysicsControllerParams", Mass=42.0),
    ]
    stats = _extractor()._ship_stats(comps)
    assert stats == {}


def test_ship_stats_empty_means_no_stats_key() -> None:
    """No whitelisted struct present => `stats` key absent entirely (caller
    only sets `base["stats"]` when the returned dict is non-empty)."""
    assert _extractor()._ship_stats([{"_Type_": "VehicleComponentParams"}]) == {}


def test_ship_stats_projects_cross_section_vec3() -> None:
    """VERIFIED against the live Nomad: SSCSignatureSystemParams has NO scalar
    IR/EM fields; the only real value is the radar cross-section Vec3 at
    `radarProperties.crossSectionParams.crossSection`, depth 3 — one level
    deeper than the generic 1-level flatten reaches. A targeted post-step
    projects it as `crossSection.x/y/z`."""
    comps = [
        _comp(
            "SSCSignatureSystemParams",
            baseSignatureParams=None,
            emissionModifierParams=None,
            radarProperties={
                "_Type_": "SRadarProps",
                "crossSectionParams": {
                    "_Type_": "SCrossSectionParams",
                    "crossSection": {"_Type_": "SVec3", "x": 6604.0, "y": 3302.0, "z": 9712.0},
                },
            },
        ),
    ]
    stats = _extractor()._ship_stats(comps)
    sig = stats["SSCSignatureSystemParams"]
    assert sig["crossSection.x"] == 6604.0
    assert sig["crossSection.y"] == 3302.0
    assert sig["crossSection.z"] == 9712.0
    # the generic 1-level flatten must NOT also pull in the deeper struct
    assert "radarProperties.crossSectionParams" not in sig


def test_ship_stats_cross_section_absent_when_no_radar_properties() -> None:
    """No `radarProperties` (or no nested crossSection) => no crossSection.*
    keys are invented."""
    comps = [_comp("SSCSignatureSystemParams", signalInfrared=1.0)]
    stats = _extractor()._ship_stats(comps)
    sig = stats["SSCSignatureSystemParams"]
    assert not any(k.startswith("crossSection.") for k in sig)
