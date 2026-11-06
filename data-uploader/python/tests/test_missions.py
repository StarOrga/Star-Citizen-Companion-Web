"""Mission projection (sc_extract/missions.py) — pure title cleanup + record mapping."""
import json
from pathlib import Path

from sc_extract.missions import clean_title, extract_missions, _category


def test_clean_title_drops_runtime_tokens_and_qualifier_segments():
    assert clean_title("~mission(ReputationRank) Rank - ~mission(CargoGradeToken) Cargo Haul ") == "Cargo Haul"
    assert clean_title("~mission(ReputationRank) Rank - Direct ~mission(CargoGradeToken) Cargo Haul") == "Direct Cargo Haul"
    assert clean_title("Illegal Blockade - Neutralizing Nine Tails Fleet") == "Illegal Blockade - Neutralizing Nine Tails Fleet"


def test_clean_title_drops_a_literal_line_break():
    assert clean_title("Need Resource for Research\\n") == "Need Resource for Research"


def test_clean_title_is_none_when_nothing_readable_is_left():
    assert clean_title("~mission(Title)") is None
    assert clean_title("~mission(Contractor|BountyTitle)") is None
    assert clean_title("<= UNINITIALIZED =>") is None
    assert clean_title("") is None


def test_category_is_the_folder_below_pu_missions():
    assert _category("libs/foundry/records/missionbroker/pu_missions/cargo/x.xml") == "cargo"
    assert _category("libs/foundry/records/missionbroker/jobboard/animals/killanimals/x.xml") == "jobboard/animals/killanimals"
    assert _category("libs/other/x.xml") is None


class _Rec:
    def __init__(self, name, guid, filename, value):
        self.name, self.guid, self.filename, self._value = name, guid, filename, value


class _DF:
    def __init__(self, entries, refs):
        self._entries, self._refs = entries, refs

    def records_by_type_name(self, t):
        return self._entries if t == "MissionBrokerEntry" else []

    def record_by_id(self, gid):
        return self._refs.get(gid)

    def record_to_dict(self, rec, max_depth=1):
        return {"_RecordValue_": rec._value}


def _ref(name, gid):
    return {"_RecordId_": gid, "_RecordName_": name}


def test_extract_missions_maps_released_records_and_skips_the_rest(tmp_path: Path):
    strings = {"@t": "Lookin' for Zeta-Prolanide", "@g": "Ruto", "@type": "Delivery", "@p": "microTech", "@tok": "~mission(Title)"}
    loc = lambda k: {"en": strings.get(k, k), "de": k, "key": k}
    refs = {
        "T": _Rec("MissionType.Delivery", "T", "", {"LocalisedTypeName": "@type"}),
        "P": _Rec("StarMapObject.Stanton4", "P", "", {"name": "@p"}),
    }
    base = {"type": _ref("MissionType.Delivery", "T"), "missionGiver": "@g",
            "locationMissionAvailable": _ref("StarMapObject.Stanton4", "P"),
            "missionReward": {"reward": 12500, "currencyType": "UEC"}, "lawfulMission": True}
    entries = [
        _Rec("MissionBrokerEntry.Good", "1", "libs/foundry/records/missionbroker/pu_missions/delivery/good.xml", {**base, "title": "@t"}),
        _Rec("MissionBrokerEntry.Templated", "2", "libs/foundry/records/missionbroker/pu_missions/delivery/t.xml", {**base, "title": "@tok"}),
        _Rec("MissionBrokerEntry.Hidden", "3", "libs/foundry/records/missionbroker/pu_missions/h.xml", {**base, "title": "@t", "notForRelease": True}),
        _Rec("MissionBrokerEntry.Test", "4", "libs/foundry/records/missionbroker/testmissions/x.xml", {**base, "title": "@t"}),
    ]
    n = extract_missions(_DF(entries, refs), loc, tmp_path, {"channel": "LIVE"})
    assert n == 2
    good = json.loads((tmp_path / "missions" / "Good.json").read_text(encoding="utf-8"))
    assert good["titleClean"] == {"en": "Lookin' for Zeta-Prolanide", "de": None}
    assert good["title"]["de"] == ""  # unresolved @-key is no text
    assert good["type"] == {"className": "Delivery", "name": {"en": "Delivery", "de": "", "key": "@type"}}
    assert good["location"]["className"] == "Stanton4" and good["location"]["name"]["en"] == "microTech"
    assert good["giver"]["name"]["en"] == "Ruto"
    assert good["reward"] == {"amount": 12500, "currency": "UEC"}
    assert good["category"] == "delivery" and good["lawful"] is True
    templated = json.loads((tmp_path / "missions" / "Templated.json").read_text(encoding="utf-8"))
    assert templated["titleClean"] is None and templated["type"]["name"]["en"] == "Delivery"
