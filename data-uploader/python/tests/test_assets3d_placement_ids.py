"""Placement ids are the manifest's primary key — one bad id fails the whole package."""

from __future__ import annotations

from sc_extract.assets3d.enrich import enrich
from sc_extract.assets3d.entity import EntityDef, LoadoutEntry, PortDef, resolve_entity
from sc_extract.assets3d.manifest import validate_manifest


class _Src:
    def entity(self, class_name):
        return None

    def helpers(self, geometry_path):
        return {}


def _ids(root, loadout):
    res = resolve_entity(root, loadout, _Src())
    return [r.path for r in res], res


def test_nameless_and_duplicate_ports_never_produce_bad_ids():
    root = EntityDef(class_name="X", ports=[
        PortDef(name=""), PortDef(name="hp_a"), PortDef(name="HP_A"), PortDef(name="hp_b")])
    loadout = [LoadoutEntry("", "foo"), LoadoutEntry("hp_b", None), LoadoutEntry("HP_B", None)]
    ids, res = _ids(root, loadout)
    assert ids == ["hp_b", "hp_a"]
    assert all(ids) and len(set(ids)) == len(ids)


def test_enrich_drops_a_repeated_id_instead_of_failing_the_package():
    root = EntityDef(class_name="X", ports=[PortDef(name="hp_a")])
    _, res = _ids(root, [])
    out = enrich(res + res, root, {})
    assert [p["id"] for p in out] == ["hp_a"]
