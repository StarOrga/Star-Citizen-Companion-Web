"""Blueprint -> contract link (sc_extract/blueprint_sources.py), record shapes as in LIVE 4.10.2."""
import json
from pathlib import Path

from sc_extract.blueprint_sources import MISSION_SOURCE_MAX, build_blueprint_sources
from sc_extract.missions import extract_missions


def ref(type_name, name, guid=None):
    return {"_RecordId_": guid or name, "_RecordName_": f"{type_name}.{name}"}


class _Rec:
    def __init__(self, name, guid, value):
        self.name, self.guid, self.filename, self._value = name, guid, "x.xml", value


class _DF:
    """records_by_type_name / record_by_id / record_to_dict, as the real DataForge answers."""

    def __init__(self, recs):
        self._recs = recs
        self._by_id = {r.guid: r for rs in recs.values() for r in rs}

    def records_by_type_name(self, t):
        return self._recs.get(t, [])

    def record_by_id(self, gid):
        return self._by_id.get(gid)

    def record_to_dict(self, rec, max_depth=64):
        return {"_RecordValue_": rec._value}


TEXTS = {
    "@title": {"en": "Routine Patrol", "de": "Routinepatrouille", "key": "@title"},
    "@desc": {"en": "Fly it.", "de": "Flieg sie.", "key": "@desc"},
    "@giver": {"en": "Foxwell", "de": "Foxwell", "key": "@giver"},
    "@type": {"en": "Mercenary", "de": "Söldner", "key": "@type"},
    "@stanton": {"en": "Stanton", "de": "Stanton", "key": "@stanton"},
    "@tok": {"en": "~mission(Title)", "de": "", "key": "@tok"},
}


def localized(key):
    return TEXTS.get(key) or {"en": key, "de": key, "key": key}


def pool(name, *rows):
    return _Rec(f"BlueprintPoolRecord.{name}", name, {"blueprintRewards": [
        {"_Type_": "BlueprintReward", "weight": w, "blueprintRecord": ref("CraftingBlueprintRecord", cn)} for cn, w in rows
    ]})


def bp_result(pool_name, chance=1.0, flags=(True, False, False, False, False)):
    return {"_Type_": "BlueprintRewards", "chance": chance, "missionResults": list(flags),
            "blueprintPool": ref("BlueprintPoolRecord", pool_name)}


def contract(name="Patrol_Easy", cid="aaaaaaaa-1111", results=None, title="@title", **over):
    return {
        "_Type_": "CareerContract", "id": cid, "debugName": name, "notForRelease": False, "workInProgress": False,
        "template": ref("ContractTemplate", "SecurityPatrol"),
        "paramOverrides": {"stringParamOverrides": [
            {"param": "Title", "value": title}, {"param": "Description", "value": "@desc"},
        ]},
        "additionalPrerequisites": [],
        "contractResults": {"contractResults": results if results is not None else [bp_result("P1")]},
        **over,
    }


def generator(*contracts, **handler):
    return _Rec("ContractGenerator.Foxwell", "gen", {"generators": [{
        "_Type_": "ContractGeneratorHandler_Career", "notForRelease": False, "workInProgress": False,
        "contractParams": {"stringParamOverrides": [{"param": "Contractor", "value": "@giver"}],
                           "boolParamOverrides": [{"param": "Illegal", "value": False}]},
        "defaultAvailability": {"prerequisites": [
            {"_Type_": "ContractPrerequisite_Location", "locationAvailable": ref("StarMapObject", "StantonStar")},
        ]},
        "contracts": list(contracts),
        **handler,
    }]})


def df_of(*generators, pools=None, template=None):
    return _DF({
        "BlueprintPoolRecord": pools if pools is not None else [pool("P1", ("BP_A", 1.0), ("BP_B", 3.0))],
        "ContractGenerator": list(generators),
        "ContractTemplate": [_Rec("ContractTemplate.SecurityPatrol", "SecurityPatrol", {
            "contractDisplayInfo": {"type": ref("MissionType", "Mercenary"), "illegal": True}, **(template or {}),
        })],
        "MissionType": [_Rec("MissionType.Mercenary", "Mercenary", {"LocalisedTypeName": "@type"})],
        "StarMapObject": [_Rec("StarMapObject.StantonStar", "StantonStar", {"name": "@stanton"})],
    })


def test_links_each_blueprint_of_the_pool_to_the_contract():
    out = build_blueprint_sources(df_of(generator(contract())), localized)
    assert sorted(out.by_blueprint) == ["BP_A", "BP_B"]
    entry = out.by_blueprint["BP_B"]
    assert entry["total"] == 1
    assert entry["missions"] == [{
        "className": "contract_Patrol_Easy",
        "title": {"en": "Routine Patrol", "de": "Routinepatrouille"},
        "giver": {"en": "Foxwell", "de": "Foxwell"},
        "location": {"en": "Stanton", "de": "Stanton"},
        "share": 0.75,
    }]
    assert out.by_blueprint["BP_A"]["missions"][0]["share"] == 0.25


def test_contract_becomes_a_mission_row_in_the_shape_of_missions_py():
    m = build_blueprint_sources(df_of(generator(contract())), localized).missions[0]
    assert m["className"] == "contract_Patrol_Easy" and m["guid"] == "aaaaaaaa-1111"
    assert m["titleClean"] == {"en": "Routine Patrol", "de": "Routinepatrouille"}
    assert m["description"]["en"] == "Fly it."
    assert m["type"]["className"] == "Mercenary" and m["type"]["name"]["de"] == "Söldner"
    assert m["giver"] == {"name": TEXTS["@giver"], "className": None}
    assert m["location"]["className"] == "StantonStar" and m["location"]["name"]["en"] == "Stanton"
    # The handler's Illegal param beats the template's display flag.
    assert m["lawful"] is True
    assert m["reward"] is None
    assert m["blueprintRewards"] == [{"pool": "P1", "chance": 1.0, "blueprints": ["BP_A", "BP_B"]}]
    assert m["contract"] == {"generator": "Foxwell", "debugName": "Patrol_Easy", "template": "SecurityPatrol"}


def test_unreleased_and_rewardless_contracts_award_nothing():
    gen = generator(
        contract("Hidden", notForRelease=True),
        contract("Wip", workInProgress=True),
        contract("NoBlueprint", results=[{"_Type_": "ContractResult_CalculatedReward"}]),
        contract("OnlyWhenFailed", results=[bp_result("P1", flags=(False, False, True, False, False))]),
        contract("NeverDrops", results=[bp_result("P1", chance=0.0)]),
    )
    out = build_blueprint_sources(df_of(gen), localized)
    assert out.missions == [] and out.by_blueprint == {}


def test_in_progress_results_earn_too():
    gen = generator(contract("Collector", results=[bp_result("P1", flags=(False, True, False, False, False))]))
    assert sorted(build_blueprint_sources(df_of(gen), localized).by_blueprint) == ["BP_A", "BP_B"]


def test_handler_not_for_release_hides_its_contracts():
    out = build_blueprint_sources(df_of(generator(contract(), notForRelease=True)), localized)
    assert out.missions == []


def test_a_template_held_back_hides_its_contracts():
    out = build_blueprint_sources(df_of(generator(contract()), template={"notForRelease": True}), localized)
    assert out.missions == []


def test_title_falls_back_to_the_handler_then_the_type_never_invented():
    handler_title = generator(
        contract(title="@missing"),
        contractParams={"stringParamOverrides": [{"param": "Title", "value": "@title"}]},
    )
    m = build_blueprint_sources(df_of(handler_title), localized).missions[0]
    # An unresolved @-key on the contract yields no text, so its type names it.
    assert m["titleClean"] is None and m["type"]["name"]["en"] == "Mercenary"

    no_own_title = contract()
    no_own_title["paramOverrides"] = {"stringParamOverrides": []}
    m = build_blueprint_sources(df_of(generator(
        no_own_title, contractParams={"stringParamOverrides": [{"param": "Title", "value": "@title"}]},
    )), localized).missions[0]
    assert m["titleClean"]["en"] == "Routine Patrol"

    tokens = build_blueprint_sources(df_of(generator(contract(title="@tok"))), localized)
    assert tokens.by_blueprint["BP_A"]["missions"][0]["title"] == {"en": "Mercenary", "de": "Söldner"}


def test_untitled_contract_without_a_type_is_dropped_with_its_links():
    df = df_of(generator(contract(title="@tok")), template={"contractDisplayInfo": {"type": None}})
    out = build_blueprint_sources(df, localized)
    assert out.missions == [] and out.by_blueprint == {}


def test_two_contracts_sharing_a_debug_name_stay_apart():
    gen = generator(contract("Decoy", cid="aaaaaaaa-1"), contract("Decoy", cid="bbbbbbbb-2"))
    names = [m["className"] for m in build_blueprint_sources(df_of(gen), localized).missions]
    assert names == ["contract_Decoy_aaaaaaaa", "contract_Decoy_bbbbbbbb"]


def test_class_names_keep_the_mission_route_plain():
    gen = generator(contract("Odd.Name/With Stuff"))
    name = build_blueprint_sources(df_of(gen), localized).missions[0]["className"]
    assert name == "contract_Odd_Name_With_Stuff"


def test_list_is_sorted_by_share_and_capped_with_the_true_total():
    pools = [pool("Big", ("BP_A", 1.0), ("BP_B", 1.0)), pool("Only", ("BP_A", 1.0))]
    many = [contract(f"C{i:02}", cid=f"id{i}", results=[bp_result("Big")]) for i in range(MISSION_SOURCE_MAX + 3)]
    best = contract("Zz_Best", cid="best", results=[bp_result("Only")])
    entry = build_blueprint_sources(df_of(generator(*many, best), pools=pools), localized).by_blueprint["BP_A"]
    assert entry["total"] == MISSION_SOURCE_MAX + 4
    assert len(entry["missions"]) == MISSION_SOURCE_MAX
    assert entry["missions"][0]["className"] == "contract_Zz_Best"
    assert entry["missions"][1]["className"] == "contract_C00"


def test_data_without_contracts_gives_an_empty_result():
    out = build_blueprint_sources(_DF({}), localized)
    assert out.missions == [] and out.by_blueprint == {}


def test_extract_missions_writes_the_contract_rows_next_to_the_broker_rows(tmp_path: Path):
    src = build_blueprint_sources(df_of(generator(contract())), localized)
    n = extract_missions(_DF({}), localized, tmp_path, {"channel": "LIVE"}, contracts=src.missions)
    assert n == 1
    body = json.loads((tmp_path / "missions" / "contract_Patrol_Easy.json").read_text(encoding="utf-8"))
    assert body["source"] == {"channel": "LIVE"} and body["titleClean"]["en"] == "Routine Patrol"
