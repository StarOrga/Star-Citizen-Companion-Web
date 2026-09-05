"""The schema-3 contract the web app's energy model depends on (§P.1).

The app reads `ItemResourceComponentParams` keys by STATE PREFIX only — it has
no bare-key fallback, because the extractor always writes one. That makes two
properties load-bearing, and neither was asserted anywhere:

  1. an emitted group carries `stateNames`, so the consumer can tell "this item
     has no NAV state" apart from "the extractor did not look";
  2. every other key in the group is `<state>.`-prefixed with a state that
     `stateNames` actually lists.

If either breaks, the app does not crash — it silently reads `null` for every
number and renders a ship whose reactor budget is unknown. This test is the
tripwire.
"""

from __future__ import annotations

import pytest

from test_resource_network_stats import (  # type: ignore[import-not-found]
    _amount,
    _extractor,
    _irc,
)

RESOURCE = "ItemResourceComponentParams"


def _states(group: dict) -> list:
    raw = group.get("stateNames")
    assert isinstance(raw, str) and raw, "stateNames must be a non-empty string"
    return [s.lower() for s in raw.split("|")]


# The resource DOMAINS the app reads. The struct's own top-level scalars
# (`isRelay`, `defaultPriority`, `selfRepair.*`) are not part of the state
# projection and are deliberately left unprefixed.
_DOMAINS = ("power", "coolant", "shield", "em", "ir", "powerRanges")


def _assert_contract(group: dict) -> None:
    prefixes = _states(group)
    prefixed = [k for k in group if k.split(".", 1)[0] in prefixes]
    assert prefixed, (
        f"no key is prefixed with one of {prefixes} — the app has no bare-key "
        f"fallback and would read every number as absent"
    )
    bare = [k for k in group if k.split(".", 1)[0] in _DOMAINS]
    assert not bare, (
        f"{bare} lost the state prefix — the app reads `<state>.` keys only"
    )


# One consumer, one generator, one multi-state record, one signature-only record.
_CONSUMER = _irc([
    {"_Type_": "ItemResourceDeltaConversion",
     "minimumConsumptionFraction": 0.6666666865348816,
     "consumption": _amount("Power", "SPowerSegmentResourceUnit", 3),
     "generation": _amount("Coolant", "SStandardResourceUnit", 34.0)},
], em=(1490.0, 0.15), ir=(7130.0, 0.5))

_GENERATOR = _irc([
    {"_Type_": "ItemResourceDeltaConversion",
     "minimumConsumptionFraction": 0.0,
     "generation": _amount("Power", "SPowerSegmentResourceUnit", 14)},
], em=(5250.0, 0.15))

_WEAPON = _irc([
    {"_Type_": "ItemResourceDeltaConversion",
     "minimumConsumptionFraction": 0.0,
     "consumption": _amount("Power", "SStandardResourceUnit", 1.0)},
], em=(0.0, 0.15), ir=(0.0, 0.15))


def _multi_state() -> dict:
    """Two states on one record — the shape the state prefix exists for."""
    online = _irc([
        {"_Type_": "ItemResourceDeltaConversion",
         "minimumConsumptionFraction": 0.5,
         "consumption": _amount("Power", "SPowerSegmentResourceUnit", 2)},
    ])
    standby = _irc([
        {"_Type_": "ItemResourceDeltaConversion",
         "minimumConsumptionFraction": 0.0,
         "consumption": _amount("Power", "SPowerSegmentResourceUnit", 1)},
    ], state="Standby")
    online["states"] = online["states"] + standby["states"]
    return online


@pytest.mark.parametrize(
    "comp",
    [_CONSUMER, _GENERATOR, _WEAPON, _multi_state()],
    ids=["cooler", "reactor", "weapon", "multi-state"],
)
def test_every_emitted_key_is_state_prefixed(comp: dict) -> None:
    for reader in ("_component_stats", "_weapon_stats"):
        stats = getattr(_extractor(), reader)([comp], "x")[RESOURCE] \
            if reader == "_component_stats" else getattr(_extractor(), reader)([comp])[RESOURCE]
        assert len(stats) > 1, "a group with only stateNames carries no data"
        _assert_contract(stats)


def test_multi_state_lists_both_prefixes() -> None:
    stats = _extractor()._component_stats([_multi_state()], "x")[RESOURCE]
    assert stats["stateNames"] == "Online|Standby"
    assert stats["online.power.consumeSegments"] == 2
    assert stats["standby.power.consumeSegments"] == 1
    _assert_contract(stats)
