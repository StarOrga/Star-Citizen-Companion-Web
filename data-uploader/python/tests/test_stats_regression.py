"""Guardrails that don't belong to a single feature:

(d) golden-key regression (red-team R3): `_component_stats()` and
    `_SKIP_COMPONENT_STATS` were explicitly NOT touched by PR A — this test
    pins that a shield and a quantum drive's stats key SET is exactly what it
    was before, so a future change to the shared helper trips a test here
    instead of silently reshaping every existing component's payload.
(e) ship payload size guard: the ship-level `stats` addition (task 1) must
    stay small — it is emitted on every ship in `codex_ships.payload`, which
    is loaded in full for `/codex`, `/codex/index` and the hangar dashboard
    list views (see docs/concepts/codex-extraction-output.md §0b "payload
    size" trap). A single whitelisted struct should stay well under 2 KB
    serialized; if a future whitelist addition blows this budget, this test
    is the trip-wire that should fail before the payload does.
"""

from __future__ import annotations

import json

from sc_extract.dataforge_extract import CodexExtractor


def _extractor() -> CodexExtractor:
    return CodexExtractor.__new__(CodexExtractor)


def _shield_resolved_comps() -> list:
    return [
        {
            "_Type_": "SCItemShieldGeneratorParams",
            "MaxShieldHealth": 4320.0,
            "MaxShieldRegen": 100.0,
            "DownedRegenDelay": 3.0,
            "DecayRegenDelay": 1.5,
            "IgnoreMeleeDamage": False,
            "Faces": {
                "_Type_": "SShieldFaceParams",
                "count": 1,
            },
        },
    ]


def _quantum_drive_resolved_comps() -> list:
    return [
        {
            "_Type_": "SCItemQuantumDriveParams",
            "driveSpeed": 100.0,
            "spoolTime": 4.0,
            "cooldownTime": 15.0,
            "quantumFuelRequirement": 10.0,
            "jumpRange": {
                "_Type_": "SQuantumJumpRange",
                "max": 20000000.0,
            },
        },
    ]


def test_shield_stats_key_set_is_pinned() -> None:
    ex = _extractor()
    stats = ex._component_stats(_shield_resolved_comps(), "Shield")
    assert set(stats.keys()) == {"SCItemShieldGeneratorParams"}
    assert set(stats["SCItemShieldGeneratorParams"].keys()) == {
        "MaxShieldHealth", "MaxShieldRegen", "DownedRegenDelay",
        "DecayRegenDelay", "IgnoreMeleeDamage", "Faces.count",
    }


def test_quantum_drive_stats_key_set_is_pinned() -> None:
    ex = _extractor()
    stats = ex._component_stats(_quantum_drive_resolved_comps(), "QuantumDrive")
    assert set(stats.keys()) == {"SCItemQuantumDriveParams"}
    assert set(stats["SCItemQuantumDriveParams"].keys()) == {
        "driveSpeed", "spoolTime", "cooldownTime",
        "quantumFuelRequirement", "jumpRange.max",
    }


def test_ship_signature_stats_payload_stays_small() -> None:
    """Synthetic but representative: the real SSCSignatureSystemParams struct
    observed on the live Nomad projects to ~1 KB serialized (validated against
    Data.p4k — see PR A report); this fixture pads it further and still stays
    under the 2 KB guard."""
    comps = [
        {
            "_Type_": "SSCSignatureSystemParams",
            "bindingURLPrefix": "Vehicle",
            "isOverridden": False,
            "enableDetectionOnItemPort": False,
            "ignoreHighlightWhenDetectorInsideBounds": False,
            "ignoreHighlightWhenNoLinkedOrActiveObjectives": False,
            "priorityBoxoutTag": None,
            "isObjectOfInterest": False,
            "radarProperties": {
                "_Type_": "SRadarProps",
                "baseSignatureParams": None,
                "emissionModifierParams": None,
                "deathParams": None,
                "scanBounds": None,
            },
            "overriddenSize": {"_Type_": "SVec3", "x": 0.0, "y": 0.0, "z": 0.0},
        },
    ]
    stats = _extractor()._ship_stats(comps)
    serialized = json.dumps(stats, ensure_ascii=False).encode("utf-8")
    assert len(serialized) < 2048, f"ship stats block grew to {len(serialized)} bytes"
