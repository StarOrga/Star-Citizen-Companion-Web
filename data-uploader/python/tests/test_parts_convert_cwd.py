"""`PartStore.convert_raw` runs the converter from the scratch root, not from the
mesh's directory: Windows refuses a cwd over 258 chars (WinError 267), however
deep the mirrored P4K path is. The tree itself stays — materials and skeletons
are resolved through it.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

from sc_extract.assets3d import parts as parts_mod
from sc_extract.assets3d.parts import PartStore
from sc_extract.glb_materials import write_glb

MESH = "Data/Objects/Spaceships/Ships/CRUS/Starlifter/Interior/Modular_Rooms/A2/frame.cga"
MTL = "Data/Objects/Spaceships/Ships/CRUS/Starlifter/shared/frame.mtl"
FILES = {MESH: b"mesh", MESH + "m": b"companion", MTL: b"<Material/>"}


def _store(tmp_path):
    return PartStore(tmp_path / "store", FILES.__getitem__, FILES.__contains__,
                     tmp_path / "cgf-converter.exe", lambda *a, **k: None, tmp_path / "work")


def test_converter_runs_from_the_scratch_root_with_the_tree_intact(tmp_path, monkeypatch):
    calls = []

    def fake_converter(cmd, cwd=None, **kwargs):
        calls.append({"cmd": cmd, "cwd": cwd})
        mesh = Path(cwd) / cmd[1]
        # What the real converter is handed must resolve from where it runs.
        assert mesh.read_bytes() == b"mesh"
        assert Path(str(mesh) + "m").read_bytes() == b"companion"
        assert (Path(cmd[cmd.index("-objectdir") + 1]) / "Objects").is_dir()
        # -mtl stays relative to the mesh, as the converter resolves it.
        assert (mesh.parent / cmd[cmd.index("-mtl") + 1]).resolve().read_bytes() == b"<Material/>"
        gltf = {"asset": {"version": "2.0", "generator": "x" * 256}}
        write_glb(mesh.with_suffix(".glb"), gltf, b"")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(parts_mod.subprocess, "run", fake_converter)
    scratch = tmp_path / "work" / "part_0123456789ab"

    produced = _store(tmp_path).convert_raw(MESH, MTL, scratch)

    call = calls[0]
    # The cwd no longer carries the P4K path, however deep it is.
    assert Path(call["cwd"]) == scratch.resolve()
    assert call["cmd"][1] == MESH
    # The glb lands next to the mesh, where callers pick it up.
    assert produced == (scratch / MESH).resolve().with_suffix(".glb")
    assert produced.exists()
    assert os.path.isfile(scratch / MTL)


DUP_KEY = (b"[ERR:Program] Failed to render\r\n  ArgumentException: An item with the same key "
           b"has already been added. Key: Unknown\r\n")


def test_material_with_unnamed_texture_slots_is_retried_texture_free(tmp_path, monkeypatch):
    """cgf-converter crashes on two unnamed texture slots (grin multitool POM
    decal); the geometry is fine, so the retry hands it a texture-free mtl."""
    mtl_xml = (b'<Material><SubMaterials><Material Name="a"><Textures>'
               b'<Texture Map="TexSlot1" File="x.tif"/><Texture Map="TexSlot2" File="x.tif"/>'
               b'</Textures></Material></SubMaterials></Material>')
    files = {**FILES, MTL: mtl_xml}
    store = PartStore(tmp_path / "store", files.__getitem__, files.__contains__,
                      tmp_path / "cgf-converter.exe", lambda *a, **k: None, tmp_path / "work")
    seen = []

    def fake_converter(cmd, cwd=None, **kwargs):
        mesh = Path(cwd) / cmd[1]
        mtl = (mesh.parent / cmd[cmd.index("-mtl") + 1]).resolve()
        seen.append(b"<Texture " in mtl.read_bytes())
        if seen[-1]:
            return SimpleNamespace(returncode=1, stdout=DUP_KEY)
        write_glb(mesh.with_suffix(".glb"), {"asset": {"version": "2.0", "generator": "x" * 256}}, b"")
        return SimpleNamespace(returncode=0, stdout=b"")

    monkeypatch.setattr(parts_mod.subprocess, "run", fake_converter)
    produced = store.convert_raw(MESH, MTL, tmp_path / "work" / "part_a")
    assert seen == [True, False] and produced.exists()


def test_unconvertible_mesh_reports_the_converter_reason(tmp_path, monkeypatch):
    out = b"  ArgumentException: boom\r\n"
    monkeypatch.setattr(parts_mod.subprocess, "run",
                        lambda cmd, **kw: SimpleNamespace(returncode=1, stdout=out))
    try:
        _store(tmp_path).convert_raw(MESH, None, tmp_path / "work" / "part_b")
    except RuntimeError as exc:
        assert "rc=1" in str(exc) and "ArgumentException: boom" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
