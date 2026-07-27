"""Tests for the layered-paint → glTF PBR resolution (`glb_materials.py`).

Regression cover for admin feedback d7f44a41: the exported Cutlass rendered as a
featureless white blob because ~42 % of its hull triangles use CryEngine
`HardSurface` submaterials whose colour lives in `<MatLayers>` — which
cgf-converter drops on the floor. These tests use synthetic glTF documents and a
stubbed CryXML parser, so they stay offline (no P4K, no converter).
"""
from __future__ import annotations

import json
import struct
import sys
from pathlib import Path
from typing import Dict
from xml.etree import ElementTree as ET

import pytest

from sc_extract import glb_materials as gm
from sc_extract.glb_materials import SubMaterial

# Real values lifted from Data/Objects/Spaceships/Ships/DRAK/Cutlass/
# Cutlass_Black/DRAK_Cutlass_Black.mtl in a live 4.9.0 Data.p4k.
CUTLASS_MTL = """<?xml version="1.0"?>
<Material MtlFlags="524544">
  <SubMaterials>
    <Material Name="Paint_Secondary" Shader="HardSurface" Diffuse="1,1,1"
              Specular="1,1,1" Opacity="1" Shininess="255" SurfaceType="metal_dense">
      <Textures />
      <MatLayers>
        <Layer Name="Primary"
               Path="Materials/vehicles/manufacturer/DRAK/drak_lf_paintedpanels_a_clean.mtl"
               TintColor="0.012983033,0.012983033,0.012983033" GlossMult="0.54838699" />
        <Layer Name="Wear"
               Path="Materials/vehicles/manufacturer/DRAK/drak_lf_paintedpanels_a_wear.mtl"
               TintColor="1,1,1" GlossMult="1" />
      </MatLayers>
    </Material>
    <Material Name="Metal_Bare" Shader="HardSurface" Diffuse="1,1,1" Opacity="1">
      <Textures />
      <MatLayers>
        <Layer Name="Primary"
               Path="Materials/vehicles/manufacturer/DRAK/drak_lf_metalpanels_b.mtl"
               TintColor="0.5,0.5,0.5" GlossMult="0.75" />
      </MatLayers>
    </Material>
    <Material Name="POM_EXT" Shader="Illum" Diffuse="1,1,1" Opacity="1" Shininess="130">
      <Textures>
        <Texture Map="TexSlot1" File="Objects/Spaceships/Ships/DRAK/textures/pom_diff.tif" />
      </Textures>
    </Material>
    <Material Name="glow_alpha" Shader="Illum" Diffuse="0.5,0.25,0.25" Opacity="0.19">
      <Textures />
    </Material>
  </SubMaterials>
</Material>
"""


@pytest.fixture(autouse=True)
def _stub_cryxml(monkeypatch: pytest.MonkeyPatch) -> None:
    """`parse_paint_mtl` reads CryXML via scdatatools; feed it plain XML instead."""
    import types

    mod = types.ModuleType("scdatatools.engine.chunkfile")

    def etree_from_cryxml_file(fp):  # noqa: ANN001
        return ET.ElementTree(ET.fromstring(fp.read().decode("utf-8")))

    mod.etree_from_cryxml_file = etree_from_cryxml_file  # type: ignore[attr-defined]
    for name in ("scdatatools", "scdatatools.engine", "scdatatools.engine.chunkfile"):
        monkeypatch.setitem(sys.modules, name, sys.modules.get(name) or types.ModuleType(name))
    monkeypatch.setitem(sys.modules, "scdatatools.engine.chunkfile", mod)


def _subs() -> Dict[str, SubMaterial]:
    return gm.parse_paint_mtl(CUTLASS_MTL.encode("utf-8"))


# ---- .mtl parsing ----------------------------------------------------------
def test_layered_paint_takes_its_colour_from_the_primary_layer_tint() -> None:
    paint = _subs()["paint_secondary"]
    assert paint.layered is True
    assert paint.has_texture is False
    # near-black: this is what makes a "Cutlass Black" black instead of white
    assert paint.base_color == pytest.approx((0.012983033,) * 3)
    assert paint.roughness == pytest.approx(1 - 0.54838699)
    assert paint.metallic == 0.0  # painted panels are dielectric


def test_metal_panel_layer_library_marks_the_surface_metallic() -> None:
    metal = _subs()["metal_bare"]
    assert metal.metallic == 1.0
    assert metal.base_color == pytest.approx((0.5, 0.5, 0.5))


def test_textured_submaterial_is_flagged_and_falls_back_to_shininess() -> None:
    pom = _subs()["pom_ext"]
    assert pom.has_texture is True
    assert pom.layered is False
    assert pom.roughness == pytest.approx(1 - 130 / 255)


def test_opacity_becomes_the_base_colour_alpha() -> None:
    glow = _subs()["glow_alpha"]
    assert glow.alpha == pytest.approx(0.19)
    assert glow.base_color == pytest.approx((0.5, 0.25, 0.25))


# ---- glb container ---------------------------------------------------------
def _write_glb(path: Path, gltf: dict, binary: bytes = b"") -> None:
    gm.write_glb(path, gltf, binary)


def test_glb_roundtrip_preserves_json_and_bin(tmp_path: Path) -> None:
    doc = {"asset": {"version": "2.0"}, "materials": [{"name": "x"}]}
    p = tmp_path / "m.glb"
    _write_glb(p, doc, b"\x01\x02\x03")  # 3 bytes -> must be padded to 4
    back, binary = gm.read_glb(p)
    assert back == doc
    assert binary[:3] == b"\x01\x02\x03"
    assert p.read_bytes()[:4] == b"glTF"
    total = struct.unpack_from("<I", p.read_bytes(), 8)[0]
    assert total == p.stat().st_size  # header length must match the real file


# ---- the patch -------------------------------------------------------------
def _doc() -> dict:
    return {
        "asset": {"version": "2.0"},
        "extensionsUsed": [gm.SPEC_GLOSS, "KHR_materials_specular"],
        "materials": [
            {"name": "Paint_Secondary",
             "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]},
             "extensions": {gm.SPEC_GLOSS: {"diffuseFactor": [1, 1, 1, 1]}}},
            {"name": "POM_EXT",
             "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1],
                                      "baseColorTexture": {"index": 0}}},
            {"name": "glow_alpha",
             "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}},
            {"name": "not_in_the_mtl",
             "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}},
        ],
    }


def test_patch_recolours_untextured_materials_and_leaves_textured_ones(tmp_path: Path) -> None:
    p = tmp_path / "raw.glb"
    _write_glb(p, _doc())
    stats = gm.patch_glb_materials(p, _subs())
    doc, _ = gm.read_glb(p)

    paint = doc["materials"][0]["pbrMetallicRoughness"]
    assert paint["baseColorFactor"][:3] == pytest.approx([0.012983033] * 3)
    assert paint["roughnessFactor"] == pytest.approx(1 - 0.54838699)
    assert paint["metallicFactor"] == 0.0

    # a correctly textured material must NOT be second-guessed
    assert doc["materials"][1]["pbrMetallicRoughness"]["baseColorFactor"] == [1, 1, 1, 1]

    assert stats["recoloured"] == 2  # Paint_Secondary + glow_alpha
    assert stats["untextured_unmatched"] == 1  # not_in_the_mtl


def test_translucent_material_gets_blend_mode(tmp_path: Path) -> None:
    p = tmp_path / "raw.glb"
    _write_glb(p, _doc())
    gm.patch_glb_materials(p, _subs())
    doc, _ = gm.read_glb(p)
    glow = doc["materials"][2]
    assert glow["pbrMetallicRoughness"]["baseColorFactor"][3] == pytest.approx(0.19)
    assert glow["alphaMode"] == "BLEND"


def test_archived_spec_gloss_extension_is_removed(tmp_path: Path) -> None:
    """three.js dropped KHR_materials_pbrSpecularGlossiness in r165, so
    <model-viewer> 4.x ignores it — keeping it only bloats the glb."""
    p = tmp_path / "raw.glb"
    _write_glb(p, _doc())
    stats = gm.patch_glb_materials(p, _subs())
    doc, _ = gm.read_glb(p)
    assert stats["spec_gloss_stripped"] == 1
    assert gm.SPEC_GLOSS not in doc.get("extensionsUsed", [])
    assert gm.SPEC_GLOSS not in doc["materials"][0].get("extensions", {})


def test_spec_gloss_diffuse_texture_is_promoted_before_removal(tmp_path: Path) -> None:
    doc = {
        "asset": {"version": "2.0"},
        "extensionsUsed": [gm.SPEC_GLOSS],
        "materials": [{
            "name": "only_spec_gloss",
            "extensions": {gm.SPEC_GLOSS: {"diffuseTexture": {"index": 7},
                                           "glossinessFactor": 0.25}},
        }],
    }
    p = tmp_path / "raw.glb"
    _write_glb(p, doc)
    gm.patch_glb_materials(p, {})
    back, _ = gm.read_glb(p)
    pbr = back["materials"][0]["pbrMetallicRoughness"]
    assert pbr["baseColorTexture"] == {"index": 7}
    assert pbr["roughnessFactor"] == pytest.approx(0.75)


# ---- no-op rigid skins -----------------------------------------------------
def _skinned_doc(joint_translation=(3.0, 0.0, 0.0), ibm_translation=(-3.0, 0.0, 0.0)) -> tuple:
    """A one-joint skinned mesh. Default values make the joint matrix identity,
    which is the degenerate rig cgf-converter emits for a .cga hierarchy."""
    ibm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, *ibm_translation, 1]
    binary = struct.pack("<16f", *[float(v) for v in ibm])
    doc = {
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(binary)}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "MAT4"}],
        "skins": [{"joints": [1], "inverseBindMatrices": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "JOINTS_0": 0,
                                                   "WEIGHTS_0": 0}}]}],
        "nodes": [
            {"name": "part", "mesh": 0, "skin": 0, "translation": list(joint_translation)},
            {"name": "joint", "translation": list(joint_translation)},
        ],
        "scenes": [{"nodes": [0, 1]}],
    }
    return doc, binary


def test_noop_rigid_skin_is_stripped_so_node_transforms_apply_again() -> None:
    """glTF 2.0 §3.7.4 makes a skinned mesh node's own transform inert, so this
    rig collapses every sub-object onto the origin in three.js/<model-viewer>."""
    doc, binary = _skinned_doc()
    stats = gm.strip_noop_skins(doc, binary)
    assert stats["stripped"] == 1
    assert stats["nodes"] == 1
    assert "skins" not in doc
    assert "skin" not in doc["nodes"][0]
    attrs = doc["meshes"][0]["primitives"][0]["attributes"]
    assert "JOINTS_0" not in attrs and "WEIGHTS_0" not in attrs
    assert attrs["POSITION"] == 0  # real vertex data is never touched


def test_real_bind_pose_is_left_alone() -> None:
    doc, binary = _skinned_doc(ibm_translation=(0.0, 0.0, 0.0))  # joint matrix != identity
    stats = gm.strip_noop_skins(doc, binary)
    assert stats["stripped"] == 0
    assert doc["skins"]
    assert doc["nodes"][0]["skin"] == 0
    assert stats["reason"] == "skin has a real bind pose — kept"


def test_unskinned_model_is_a_no_op() -> None:
    assert gm.strip_noop_skins({"asset": {"version": "2.0"}}, b"")["stripped"] == 0


def test_patch_reports_the_skin_strip(tmp_path: Path) -> None:
    doc, binary = _skinned_doc()
    doc["materials"] = [{"name": "Paint_Secondary",
                         "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}}]
    doc["meshes"][0]["primitives"][0]["material"] = 0
    p = tmp_path / "raw.glb"
    gm.write_glb(p, doc, binary)
    stats = gm.patch_glb_materials(p, _subs())
    assert stats["skins_stripped"] == 1
    back, _ = gm.read_glb(p)
    assert "skins" not in back
    assert back["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"][:3] == pytest.approx(
        [0.012983033] * 3)


# ---- interior strip --------------------------------------------------------
@pytest.mark.parametrize("name,expected", [
    ("internal_structure", True),
    ("internal_pom", True),
    ("Int_Decal_POM_A", True),
    ("POM_L_INT", True),
    ("Decal_Text_INT", True),
    ("cockpit_interior", True),
    ("POM_EXT", False),
    ("Paint_Secondary", False),
    ("Decals_EXT", False),
    ("", False),
])
def test_interior_material_detection(name: str, expected: bool) -> None:
    assert gm.is_interior_material(name) is expected


def _geom_doc() -> dict:
    acc = [{"count": 30}, {"count": 60}, {"count": 90}]
    return {
        "asset": {"version": "2.0"},
        "accessors": acc,
        "materials": [{"name": "POM_EXT"}, {"name": "internal_structure"}],
        "meshes": [
            {"name": "Body", "primitives": [
                {"material": 0, "indices": 0, "attributes": {"POSITION": 0}},
                {"material": 1, "indices": 1, "attributes": {"POSITION": 0}},
            ]},
            {"name": "InteriorOnly", "primitives": [
                {"material": 1, "indices": 2, "attributes": {"POSITION": 0}},
            ]},
        ],
        "nodes": [{"name": "body", "mesh": 0}, {"name": "int", "mesh": 1}],
        "scenes": [{"nodes": [0, 1]}],
    }


def test_interior_geometry_is_dropped_and_mesh_indices_stay_valid(tmp_path: Path) -> None:
    p = tmp_path / "raw.glb"
    _write_glb(p, _geom_doc())
    stats = gm.drop_interior_geometry(p)
    doc, _ = gm.read_glb(p)

    assert stats["dropped_primitives"] == 2
    assert stats["dropped_triangles"] == 60 // 3 + 90 // 3
    # the all-interior mesh is gone, and its node no longer points at a mesh
    assert [m["name"] for m in doc["meshes"]] == ["Body"]
    assert doc["nodes"][0]["mesh"] == 0
    assert "mesh" not in doc["nodes"][1]
    # every surviving mesh reference must be in range (invalid glTF otherwise)
    for node in doc["nodes"]:
        if "mesh" in node:
            assert 0 <= node["mesh"] < len(doc["meshes"])
    assert all(m["primitives"] for m in doc["meshes"])


def test_interior_strip_is_a_no_op_without_interior_materials(tmp_path: Path) -> None:
    doc = _geom_doc()
    doc["materials"] = [{"name": "POM_EXT"}, {"name": "Trims_EXT"}]
    p = tmp_path / "raw.glb"
    _write_glb(p, doc)
    stats = gm.drop_interior_geometry(p)
    assert stats["dropped_primitives"] == 0
    back, _ = gm.read_glb(p)
    assert json.dumps(back, sort_keys=True) == json.dumps(doc, sort_keys=True)
