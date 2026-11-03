"""Only genuine SCItemManufacturer records become catalog manufacturers.

The DCB holds per-paint ``Paint_*_Logo`` and per-shop ``Shop_*`` records of the
same type; they borrow a real maker's localization keys but have no ``Code``.
"""
from pathlib import Path
from types import SimpleNamespace

from sc_extract.dataforge_extract import CodexExtractor, _is_real_manufacturer


def test_rule_needs_code_and_a_non_paint_shop_path() -> None:
    assert _is_real_manufacturer("AEGS", "libs/foundry/records/scitem/manufacturer/aegs.xml", "AEG")
    assert not _is_real_manufacturer("Paint_Vanguard_Blue_Logo", "x/manufacturer/p.xml", None)
    assert not _is_real_manufacturer("Paint_X_Logo", "x/manufacturer/p.xml", "  ")
    assert not _is_real_manufacturer("Foo", "records/paints/foo.xml", "FOO")
    assert not _is_real_manufacturer("Bar", r"Records\Shops\bar.xml", "BAR")
    assert _is_real_manufacturer("NoPath", None, "NOP")


class _Df:
    def __init__(self, recs):
        self.recs = recs

    def records_by_type_name(self, _t):
        return self.recs

    def record_to_dict(self, r, max_depth=8):
        return {"_RecordValue_": r.value}


def _rec(name, guid, value, filename="libs/foundry/records/scitem/manufacturer/x.xml"):
    return SimpleNamespace(name="SCItemManufacturer." + name, guid=guid,
                           value=value, filename=filename)


def test_extract_skips_paint_records_and_realiases_their_guid(tmp_path: Path) -> None:
    ex = CodexExtractor.__new__(CodexExtractor)
    key = "@manufacturer_NameAEGS"
    ex.df = _Df([
        _rec("AEGS", "g-real", {"Code": "AEG", "Localization": {"Name": key}}),
        _rec("Paint_Constellation_Red_Logo", "g-paint", {"Localization": {"Name": key}}),
    ])
    ex.out = tmp_path
    ex.source = {}
    ex._manu_cache = {}
    ex.counts = {}
    ex.on_log = lambda *a, **k: None
    ex._bump = lambda k, n: ex.counts.__setitem__(k, n)
    ex._localized = lambda k: {"en": "Aegis Dynamics", "de": "", "key": k}
    ex.extract_manufacturers()

    assert ex.counts["manufacturers"] == 1
    assert [p.name for p in (tmp_path / "manufacturers").iterdir()] == ["AEGS.json"]
    # an item whose AttachDef points at the paint record still gets the real maker
    ref = ex._manufacturer_ref({"Manufacturer": {"_RecordId_": "g-paint"}})
    assert ref["code"] == "AEG" and ref["className"] == "AEGS"
