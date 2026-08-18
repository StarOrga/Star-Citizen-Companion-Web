"""Weapon fireRate derivation (PR A task 3 / red-team R4).

Before this: `_weapon_params()` took the FIRST `fireRate` found anywhere in the
resolved record via a generic depth-first search — which was frequently a
charge/sequence-wrapper action sitting at 0, and even when it wasn't, the flat
`SCItemWeaponComponentParams.fireRate: 0.0` scalar (copied verbatim by
`_scalars(wcp)`) only got overwritten if a value was already absent, so a
literal 0.0 always shadowed the truth. `damagePerSecond()` on the frontend
multiplies by this value directly, so a wrong unit or a shadowed 0 quietly
zeroes every DPS figure in the app — this is deliberately over-tested.

Now: walk `fireActions` collecting `SWeaponActionFire*Params` structs (fire
actions are inline, not cross-record refs), pick the first one with a positive
`fireRate`, sanity-band it (30-15000 rpm), and unconditionally overwrite the
flat scalar.

Struct-name note (verified against the LIVE 4.9.0 P4K, `KLWE_LaserRepeater_S3`,
PR A report): the concrete leaf that actually carries `fireRate` is
`SWeaponActionFireSingleParams` (fireRate 750, RPM), nested two levels under
`fireActions[0].sequenceEntries[0].weaponAction` inside a
`SWeaponActionSequenceParams` wrapper that carries NO `fireRate` field of its
own. An earlier, unverified draft of this file assumed a single literal type
name `SWeaponActionFireParams`, which does not exist in the live schema and
would have matched zero real weapons — `_is_fire_action_struct()` now matches
generically on the `SWeaponActionFire` prefix + literal `fireRate` presence,
covering `...FireSingleParams` and any sibling burst/charge/rapid variant
without hard-coding one name.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import (
    CodexExtractor,
    _collect_fire_actions,
    _select_fire_action,
)


def _extractor() -> CodexExtractor:
    return CodexExtractor.__new__(CodexExtractor)


def fire_action(rpm: float, variant: str = "Single", **extra) -> dict:
    """A concrete fire-action leaf, e.g. `SWeaponActionFireSingleParams` (the
    variant verified against the live P4K); any `SWeaponActionFire*Params`
    name with a literal `fireRate` matches."""
    return {"_Type_": f"SWeaponActionFire{variant}Params", "fireRate": rpm, **extra}


def sequence_wrapper(*actions) -> dict:
    """`SWeaponActionSequenceParams` (the real wrapper struct, verified) does
    NOT carry its own `fireRate` field, so it's never itself a match — only
    its nested `sequenceEntries[].weaponAction` leaves are. Modelled here as a
    plain nesting container since `_collect_fire_actions` descends generically
    into any dict/list, not just the real field names."""
    return {"_Type_": "SWeaponActionSequenceParams",
            "sequenceEntries": [{"_Type_": "SWeaponSequenceEntryParams", "weaponAction": a}
                                 for a in actions]}


class TestCollectFireActions:
    def test_finds_top_level_action(self) -> None:
        actions = _collect_fire_actions([fire_action(300.0)])
        assert len(actions) == 1
        assert actions[0]["fireRate"] == 300.0

    def test_descends_into_sequence_wrapper(self) -> None:
        node = [sequence_wrapper(fire_action(0.0), fire_action(300.0))]
        actions = _collect_fire_actions(node)
        # the sequence wrapper's own struct (SWeaponActionSequenceParams) is
        # never a match — it has no literal fireRate key at all (verified on
        # the live P4K) — only the two nested weaponAction leaves are, in order
        assert len(actions) == 2
        assert [a["fireRate"] for a in actions] == [0.0, 300.0]

    def test_ignores_non_fire_action_structs(self) -> None:
        node = {"_Type_": "SWeaponActionReloadParams", "duration": 1.0}
        assert _collect_fire_actions(node) == []


class TestSelectFireAction:
    def test_charge_action_zero_then_real_action_wins(self) -> None:
        """The exact scenario named in the task: a nested sequence wrapper
        with a disabled/placeholder fire-action leaf (fireRate 0) first, a
        real fire action (300) second -> 300 wins, not 0 and not None."""
        actions = _collect_fire_actions([sequence_wrapper(fire_action(0.0), fire_action(300.0))])
        fa, rpm = _select_fire_action(actions)
        assert rpm == 300.0
        assert fa["fireRate"] == 300.0

    def test_first_positive_value_wins_over_later_ones(self) -> None:
        actions = [fire_action(150.0), fire_action(600.0)]
        fa, rpm = _select_fire_action(actions)
        assert rpm == 150.0

    def test_zero_actions_are_skipped_not_selected(self) -> None:
        actions = [fire_action(0.0), fire_action(0.0), fire_action(450.0)]
        fa, rpm = _select_fire_action(actions)
        assert rpm == 450.0

    def test_no_positive_action_is_absent(self) -> None:
        actions = [fire_action(0.0), fire_action(0.0)]
        fa, rpm = _select_fire_action(actions)
        assert fa is None and rpm is None

    def test_no_actions_is_absent(self) -> None:
        assert _select_fire_action([]) == (None, None)

    def test_below_band_is_absent_not_clamped(self) -> None:
        fa, rpm = _select_fire_action([fire_action(20.0)])
        assert fa is None and rpm is None

    def test_above_band_is_absent_not_clamped(self) -> None:
        fa, rpm = _select_fire_action([fire_action(90000.0)])
        assert fa is None and rpm is None

    def test_band_boundaries_are_inclusive(self) -> None:
        assert _select_fire_action([fire_action(30.0)])[1] == 30.0
        assert _select_fire_action([fire_action(15000.0)])[1] == 15000.0


class TestWeaponParamsIntegration:
    """Exercises the full `_weapon_params()` path, same synthetic-dict style
    as test_armor_stats.py."""

    def _wcp(self, fire_actions, flat_fire_rate=0.0) -> dict:
        return {
            "_Type_": "SCItemWeaponComponentParams",
            "fireRate": flat_fire_rate,  # the flat scalar that used to shadow
            "fireActions": fire_actions,
        }

    def test_flat_zero_scalar_is_overwritten_by_real_action(self) -> None:
        wcp = self._wcp([sequence_wrapper(fire_action(0.0), fire_action(300.0))])
        params = _extractor()._weapon_params(wcp, {"_RecordValue_": {}})
        assert params["fireRate"] == 300.0

    def test_out_of_band_value_leaves_field_absent(self) -> None:
        for bogus in (20.0, 90000.0):
            wcp = self._wcp([fire_action(bogus)])
            params = _extractor()._weapon_params(wcp, {"_RecordValue_": {}})
            assert "fireRate" not in params, bogus

    def test_no_fire_actions_leaves_field_absent_never_stale_zero(self) -> None:
        wcp = self._wcp([])
        params = _extractor()._weapon_params(wcp, {"_RecordValue_": {}})
        assert "fireRate" not in params

    def test_selected_action_pps_and_heat_are_filled(self) -> None:
        # VERIFIED shape (KLWE_LaserRepeater_S3): pelletCount lives under
        # launchParams, NOT as a top-level `projectilesPerShot` on the fire
        # action leaf; heatPerShot IS top-level.
        wcp = self._wcp([fire_action(300.0, heatPerShot=12.0,
                                      launchParams={"_Type_": "SProjectileLauncher", "pelletCount": 6})])
        params = _extractor()._weapon_params(wcp, {"_RecordValue_": {}})
        assert params["fireRate"] == 300.0
        assert params["projectilesPerShot"] == 6.0
        assert params["heatPerShot"] == 12.0

    def test_golden_shape_klwe_laserrepeater_s3(self) -> None:
        """Golden-key regression pinned against the LIVE 4.9.0 P4K
        (KLWE_LaserRepeater_S3, PR A report): a `SWeaponActionSequenceParams`
        wrapping `sequenceEntries[].weaponAction` leaves shaped as
        `SWeaponActionFireSingleParams`, fireRate 750 RPM, pelletCount 1 under
        launchParams, heatPerShot 0.0 (so absent, not a stale 0)."""
        real_shape_fire_action = {
            "_Type_": "SWeaponActionFireSingleParams",
            "fireRate": 750,
            "heatPerShot": 0.0,
            "launchParams": {"_Type_": "SProjectileLauncher", "pelletCount": 1,
                              "damageMultiplier": 1.0},
        }
        wcp = self._wcp([sequence_wrapper(real_shape_fire_action)])
        params = _extractor()._weapon_params(wcp, {"_RecordValue_": {}})
        assert params["fireRate"] == 750
        assert params["projectilesPerShot"] == 1.0  # pelletCount 1 (single-pellet gun)
        assert "heatPerShot" not in params  # 0.0 is not > 0, so absent (never a stale zero)
