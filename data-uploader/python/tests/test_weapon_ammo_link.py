"""Weapon → ammunition link on the weapon payload (schema 6, admin feedback #237).

The countermeasure block on the ship page needs the round a launcher fires —
the decoy's IR / EM / cross-section values live on the `AmmoParams` record,
never on the launcher. `SCItemWeaponComponentParams.ammoContainerRecord` is
null on all 188 launchers (and on every ship gun), and no `<launcher>_AMMO`
naming convention exists, so until now no launcher hardpoint showed a number.

VERIFIED against the LIVE 4.10 `Data/Game2.dcb` (probe 2026-09-18): the link
is the weapon entity's OWN

    Components[_Type_ == "SAmmoContainerComponentParams"].ammoParamsRecord

a cross-file Reference stub to `AmmoParams.<class>`; `maxAmmoCount` on the
same struct is the magazine. FPS weapons point `ammoContainerRecord` at a
separate magazine entity carrying the same struct (second hop). Coverage on
that probe: 188/188 countermeasure launchers, 195/196 ship guns + rocket pods
(50 of them NOT `<class>_AMMO`), 390/395 FPS weapons (binoculars miss), all 16
tractor / towing / salvage beams (placeholder rounds); mining lasers and
`BEHR_JavelinBallisticCannon_S7_LowPoly` carry no round at all.

`tests/fixtures/live_weapon_ammo_links.json` holds the trimmed live structs of
16 of those weapons (+ the one FPS magazine) with the values the resolver
produced on the real archive — the contract the web reader depends on.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sc_extract.dataforge_extract import (
    CodexExtractor,
    _ammo_params_ref,
    _attach_def,
    _find_component,
)

FIXTURE = Path(__file__).parent / "fixtures" / "live_weapon_ammo_links.json"


class _Record:
    def __init__(self, guid: str, name: str, comps: list) -> None:
        self.guid = guid
        self.name = name
        self.comps = comps


class _FakeDataForge:
    """Just enough of `DataForge` for the magazine hop: GUID lookup + resolve."""

    def __init__(self, records: dict[str, _Record]) -> None:
        self._records = records

    def record_by_id(self, guid: str):
        return self._records.get(guid)

    def record_to_dict(self, record: _Record, max_depth: int = 64) -> dict:
        return {"_RecordName_": record.name, "_RecordId_": record.guid,
                "_RecordValue_": {"Components": record.comps}}


def _extractor(records: dict[str, _Record] | None = None) -> CodexExtractor:
    ex = CodexExtractor.__new__(CodexExtractor)
    ex.df = _FakeDataForge(records or {})
    ex.on_log = lambda *_: None
    return ex


def ammo_ref(cls: str, guid: str = "86b74da3-efe3-9621-f43b-f59403434aac") -> dict:
    return {"_RecordId_": guid, "_RecordName_": f"AmmoParams.{cls}",
            "_RecordPath_": f"libs/foundry/records/ammoparams/vehicle/ammoparams.{cls.lower()}.xml"}


def container(ref, max_ammo=48, **extra) -> dict:
    """The live `SAmmoContainerComponentParams` shape (Nomad decoy launcher)."""
    base = {
        "_Type_": "SAmmoContainerComponentParams",
        "initialAmmoCount": max_ammo,
        "maxAmmoCount": max_ammo,
        "maxRestockCount": 3,
        "ammoParamsRecord": ref,
        "secondaryAmmoParamsRecord": None,
        "ammoContainerType": "Primary",
    }
    base.update(extra)
    return base


def wcp(ammo_container_record=None) -> dict:
    return {"_Type_": "SCItemWeaponComponentParams",
            "ammoContainerRecord": ammo_container_record, "fireRate": 0.0}


class TestAmmoParamsRef:
    def test_returns_the_stub_on_a_live_container(self) -> None:
        ref = ammo_ref("BEHR_Flare")
        assert _ammo_params_ref(container(ref)) is ref

    def test_none_without_a_container_or_a_round(self) -> None:
        assert _ammo_params_ref(None) is None
        assert _ammo_params_ref({}) is None
        assert _ammo_params_ref(container(None)) is None

    def test_rejects_a_reference_that_is_not_an_ammoparams_record(self) -> None:
        wrong = {"_RecordId_": "x", "_RecordName_": "EntityClassDefinition.BEHR_Flare"}
        assert _ammo_params_ref(container(wrong)) is None
        assert _ammo_params_ref(container({"_RecordId_": "x"})) is None


class TestWeaponAmmoLink:
    def test_countermeasure_launcher_reads_its_own_container(self) -> None:
        # CNOU_Nomad_CML_Flare, live: ammoContainerRecord null, own container
        # → AmmoParams.BEHR_Flare, 48 rounds.
        comps = [wcp(None), container(ammo_ref("BEHR_Flare"), 48)]
        assert _extractor()._weapon_ammo_link(comps, comps[0]) == {
            "ammoClassName": "BEHR_Flare",
            "ammoGuid": "86b74da3-efe3-9621-f43b-f59403434aac",
            "ammoCapacity": 48,
        }

    def test_gun_with_an_unconventional_round_name_resolves_too(self) -> None:
        comps = [wcp(None), container(ammo_ref("RSI_Perseus_BallisticCannon_S8_AMMO", "e5"), 900)]
        out = _extractor()._weapon_ammo_link(comps, comps[0])
        assert out["ammoClassName"] == "RSI_Perseus_BallisticCannon_S8_AMMO"
        assert out["ammoCapacity"] == 900

    def test_energy_weapon_has_no_capacity_but_keeps_the_link(self) -> None:
        # KLWE_LaserRepeater_S3: maxAmmoCount is a literal 0 on every laser.
        comps = [wcp(None), container(ammo_ref("KLWE_LaserRepeater_S3_AMMO"), 0)]
        out = _extractor()._weapon_ammo_link(comps, comps[0])
        assert out["ammoClassName"] == "KLWE_LaserRepeater_S3_AMMO"
        assert "ammoCapacity" not in out

    def test_int32_max_sentinel_is_not_a_capacity(self) -> None:
        # Salvage_Head_standard carries 2147483647 — "infinite", not a magazine.
        comps = [wcp(None), container(ammo_ref("klwe_rifle_energy_01_ammo_laser"), 2**31 - 1)]
        out = _extractor()._weapon_ammo_link(comps, comps[0])
        assert out["ammoClassName"] == "klwe_rifle_energy_01_ammo_laser"
        assert "ammoCapacity" not in out

    def test_fps_weapon_hops_to_its_magazine_entity(self) -> None:
        mag_guid = "2f1c0b7e-0000-4000-8000-000000000001"
        magazine = _Record(mag_guid, "EntityClassDefinition.behr_rifle_ballistic_01_mag",
                           [container(ammo_ref("behr_rifle_ballistic_01_ammo_5mm", "19cc"), 40)])
        acr = {"_RecordId_": mag_guid, "_RecordName_": magazine.name, "_RecordPath_": "x.xml"}
        comps = [wcp(acr)]  # no container of its own
        out = _extractor({mag_guid: magazine})._weapon_ammo_link(comps, comps[0])
        assert out == {"ammoClassName": "behr_rifle_ballistic_01_ammo_5mm",
                       "ammoGuid": "19cc", "ammoCapacity": 40}

    def test_own_container_wins_over_the_magazine_hop(self) -> None:
        mag_guid = "2f1c0b7e-0000-4000-8000-000000000002"
        magazine = _Record(mag_guid, "EntityClassDefinition.other_mag",
                           [container(ammo_ref("OTHER_ROUND", "ff"), 10)])
        acr = {"_RecordId_": mag_guid, "_RecordName_": magazine.name}
        comps = [wcp(acr), container(ammo_ref("BEHR_Flare"), 48)]
        out = _extractor({mag_guid: magazine})._weapon_ammo_link(comps, comps[0])
        assert out["ammoClassName"] == "BEHR_Flare"

    def test_nothing_is_guessed_when_no_round_exists(self) -> None:
        # Mining lasers: no container at all. Javelin S7 LowPoly: a container
        # with no round. An unknown magazine GUID: nothing to hop to.
        ex = _extractor()
        assert ex._weapon_ammo_link([wcp(None)], wcp(None)) == {}
        comps = [wcp(None), container(None, 276)]
        assert ex._weapon_ammo_link(comps, comps[0]) == {}
        dangling = wcp({"_RecordId_": "0000-not-there", "_RecordName_": "EntityClassDefinition.gone"})
        assert ex._weapon_ammo_link([dangling], dangling) == {}

    def test_magazine_resolve_failure_is_logged_not_raised(self) -> None:
        mag_guid = "2f1c0b7e-0000-4000-8000-000000000003"

        class _Broken(_FakeDataForge):
            def record_to_dict(self, record, max_depth=64):
                raise ValueError("corrupt struct")

        ex = _extractor()
        ex.df = _Broken({mag_guid: _Record(mag_guid, "EntityClassDefinition.mag", [])})
        logged: list = []
        ex.on_log = lambda lvl, msg: logged.append((lvl, msg))
        acr = {"_RecordId_": mag_guid, "_RecordName_": "EntityClassDefinition.mag"}
        assert ex._weapon_ammo_link([wcp(acr)], wcp(acr)) == {}
        assert logged and logged[0][0] == "warn"


# ── contract against the live records ─────────────────────────────────────────
@pytest.fixture(scope="module")
def live() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def _live_extractor(live: dict) -> CodexExtractor:
    records = {guid: _Record(guid, m["name"], m["components"])
               for guid, m in live["magazines"].items()}
    return _extractor(records)


class TestLiveContract:
    def test_every_fixture_weapon_resolves_exactly_as_probed(self, live: dict) -> None:
        ex = _live_extractor(live)
        for name, entry in live["weapons"].items():
            comps = entry["components"]
            w = _find_component(comps, "SCItemWeaponComponentParams") or {}
            assert ex._weapon_ammo_link(comps, w) == entry["expected"], name

    def test_all_five_countermeasure_rounds_are_reachable(self, live: dict) -> None:
        # The launchers in the fixture cover every round the 188 live launchers
        # fire: BEHR_Flare (77), TALN_Chaff (74), JOKR_Flare (18), JOKR_Chaff
        # (17), NOVA_Chaff (2).
        ex = _live_extractor(live)
        rounds = set()
        for entry in live["weapons"].values():
            comps = entry["components"]
            if (_attach_def(comps) or {}).get("SubType") != "CountermeasureLauncher":
                continue
            out = ex._weapon_ammo_link(comps, _find_component(comps, "SCItemWeaponComponentParams"))
            assert out.get("ammoClassName"), "a live launcher must resolve"
            assert out["ammoCapacity"] > 0, "a live launcher carries rounds"
            rounds.add(out["ammoClassName"])
        assert rounds == {"BEHR_Flare", "TALN_Chaff", "JOKR_Flare", "JOKR_Chaff", "NOVA_Chaff"}

    def test_nomad_by_hand(self, live: dict) -> None:
        # The two hardpoints the admin looks at first (topic #236/#237).
        ex = _live_extractor(live)
        flare = live["weapons"]["CNOU_Nomad_CML_Flare"]["components"]
        chaff = live["weapons"]["CNOU_Nomad_CML_Chaff"]["components"]
        assert ex._weapon_ammo_link(flare, _find_component(flare, "SCItemWeaponComponentParams")) == {
            "ammoClassName": "BEHR_Flare",
            "ammoGuid": "86b74da3-efe3-9621-f43b-f59403434aac",
            "ammoCapacity": 48,
        }
        assert ex._weapon_ammo_link(chaff, _find_component(chaff, "SCItemWeaponComponentParams")) == {
            "ammoClassName": "TALN_Chaff",
            "ammoGuid": "1bee4ef0-5492-fba1-a90e-503c5e81fd8e",
            "ammoCapacity": 5,
        }

    def test_ammo_container_record_is_null_on_every_live_launcher(self, live: dict) -> None:
        # The premise of the whole topic — the field the earlier reader waited
        # on never carries the link for ship weapons.
        for name, entry in live["weapons"].items():
            comps = entry["components"]
            if (_attach_def(comps) or {}).get("SubType") != "CountermeasureLauncher":
                continue
            w = _find_component(comps, "SCItemWeaponComponentParams")
            assert w["ammoContainerRecord"] is None, name
