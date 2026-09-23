"""The published hull is geometry only — never CIG's texture art.

Every glb in the public `ship-skins` bucket is downloadable by anyone, and the
RSI Fankit & Fandom FAQ forbids uploading their content for "download by
others". These tests pin the two halves of that rule: `strip_to_geometry`
leaves no texture, image or UV behind, and `export_ship` builds ONE hull per
ship while the other paints travel as store icons only.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import List

from sc_extract import glb_materials as gm
from sc_extract.hull3d import (EXPORT_FORMAT, Hull3DExporter, HullExportConfig, Paint,
                               ShipSpec, hull_paint)


def _textured_glb(path: Path) -> None:
    """Converter-shaped output: textured hull, a proxy shell, an unassigned part."""
    gltf = {
        "asset": {"version": "2.0"},
        "extensionsUsed": ["EXT_texture_webp", "KHR_materials_specular",
                           "KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": [{"name": "Nose", "mesh": 0}, {"name": "Proxy", "mesh": 1}],
        "meshes": [
            {"primitives": [
                {"attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2,
                                "TANGENT": 3}, "material": 0},
                {"attributes": {"POSITION": 0, "NORMAL": 1}},
            ]},
            {"primitives": [{"attributes": {"POSITION": 0}, "material": 1}]},
        ],
        "materials": [
            {"name": "greeble", "alphaMode": "MASK",
             "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
             "normalTexture": {"index": 1},
             "extensions": {"KHR_materials_specular": {"specularFactor": 0.5}}},
            {"name": "proxy", "alphaMode": "MASK",
             "pbrMetallicRoughness": {"baseColorFactor": [1, 0, 0, 0.1]}},
        ],
        "textures": [{"source": 0}, {"source": 1}],
        "images": [{"mimeType": "image/webp", "bufferView": 0},
                   {"mimeType": "image/webp", "bufferView": 0}],
        "samplers": [{"wrapS": 10497}],
        "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3"},
                      {"componentType": 5126, "count": 3, "type": "VEC3"},
                      {"componentType": 5126, "count": 3, "type": "VEC2"},
                      {"componentType": 5126, "count": 3, "type": "VEC4"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
        "buffers": [{"byteLength": 4}],
    }
    gm.write_glb(path, gltf, b"webp")


def test_strip_leaves_no_texture_image_or_uv(tmp_path: Path) -> None:
    glb = tmp_path / "hull.glb"
    _textured_glb(glb)

    stats = gm.strip_to_geometry(glb)

    gltf, _ = gm.read_glb(glb)
    assert stats["images_dropped"] == 2
    for key in ("textures", "images", "samplers"):
        assert key not in gltf
    assert gltf["extensionsUsed"] == ["KHR_mesh_quantization"]
    for mat in gltf["materials"]:
        assert set(mat) == {"name", "pbrMetallicRoughness"}
        assert "baseColorTexture" not in mat["pbrMetallicRoughness"]
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            assert not any(k.startswith("TEXCOORD_") or k == "TANGENT"
                           for k in prim["attributes"])


def test_strip_drops_proxies_and_fills_unassigned_parts(tmp_path: Path) -> None:
    glb = tmp_path / "hull.glb"
    _textured_glb(glb)

    stats = gm.strip_to_geometry(glb)

    gltf, _ = gm.read_glb(glb)
    assert stats["hidden_primitives"] == 1
    assert len(gltf["meshes"]) == 1                 # the proxy-only mesh is gone
    assert "mesh" not in gltf["nodes"][1]
    names = [m["name"] for m in gltf["materials"]]
    prims = gltf["meshes"][0]["primitives"]
    assert [names[p["material"]] for p in prims] == ["hull", "hull"]


def test_strip_keeps_three_distinct_material_classes(tmp_path: Path) -> None:
    """Classes must differ in VALUE: `gltf-transform optimize` dedups identical
    materials and keeps the first name — on the real Avenger Stalker the whole
    hull came out as one material called "proxy"."""
    glb = tmp_path / "hull.glb"
    _textured_glb(glb)
    gltf, binary = gm.read_glb(glb)
    gltf["materials"][0]["name"] = "Glass_Canopy"
    gltf["meshes"][0]["primitives"].append(
        {"attributes": {"POSITION": 0}, "material": len(gltf["materials"])})
    gltf["materials"].append({"name": "glows"})
    gm.write_glb(glb, gltf, binary)

    stats = gm.strip_to_geometry(glb)

    gltf, _ = gm.read_glb(glb)
    assert stats["materials"] == ["glass", "hull", "glow"]
    mats = gltf["materials"]
    assert [m["name"] for m in mats] == ["glass", "hull", "glow"]
    assert len({json.dumps(m, sort_keys=True) for m in mats}) == 3
    assert mats[2]["emissiveFactor"] == [1.0, 1.0, 1.0]


def test_hull_paint_prefers_the_factory_finish() -> None:
    paints = [Paint(mtl="a.mtl", id="pirate"), Paint(mtl="b.mtl", id="stock", source="factory"),
              Paint(mtl="c.mtl", id="standard")]
    assert hull_paint(paints).id == "standard"
    assert hull_paint(paints[:2]).id == "stock"
    assert hull_paint(paints[:1]).id == "pirate"
    assert hull_paint([Paint(mtl="", id="standard")]) is None


class _FakeP4K:
    def infolist(self) -> list:
        return []


def test_export_ship_builds_one_hull_and_replaces_the_old_export(tmp_path: Path) -> None:
    cfg = HullExportConfig(cgf_converter=tmp_path / "c.exe", out_dir=tmp_path / "out",
                           work_dir=tmp_path / "work")
    ex = Hull3DExporter(_FakeP4K(), cfg)
    built: List[str] = []

    def fake_hull(spec, paint, ship_out):
        built.append(paint.id)
        return {"model": f"models/{spec.ship_id}_{paint.id}.glb", "model_mb": 0.2}

    ex._export_hull = fake_hull  # type: ignore[method-assign]
    ex._export_icon = lambda paint, ship_out: f"icons/{paint.id}.webp"  # type: ignore[method-assign]
    # A textured export of the old pipeline, already uploaded.
    old = cfg.out_dir / "SHIP_A"
    (old / "models").mkdir(parents=True)
    (old / "models" / "SHIP_A_pirate.glb").write_bytes(b"textured")
    (old / ".uploaded").write_text("SHIP_A 3 rows")

    ex.export_ship(ShipSpec(ship_id="SHIP_A", hull_cga="x.cga", objectdir_anchor="Data",
                            paints=[Paint(mtl="p.mtl", id="pirate", icon_dds="p.dds"),
                                    Paint(mtl="s.mtl", id="standard", icon_dds="s.dds")]))

    assert built == ["standard"]
    assert not (old / ".uploaded").exists()
    assert not (old / "models" / "SHIP_A_pirate.glb").exists()
    cat = json.loads((old / "skins.json").read_text(encoding="utf-8"))
    assert cat["format"] == EXPORT_FORMAT
    assert [(s["id"], s["model"], s["icon"]) for s in cat["skins"]] == [
        ("pirate", None, "icons/pirate.webp"),
        ("standard", "models/SHIP_A_standard.glb", "icons/standard.webp"),
    ]
