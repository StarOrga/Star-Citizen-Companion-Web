"""Tests for defaultProfile.xml keybinding extraction.

Run via: python -m pytest data-uploader/python/tests/

The fixture mirrors the shapes seen in a real SC ``Data/Libs/Config/
defaultProfile.xml``: device bindings as attributes on ``<action>``, as
``<rebind>`` children with an explicit ``device``, and as ``<rebind>`` children
whose device is implied by the input's prefix (``kb1_`` / ``mo1_`` / ``gp1_`` /
``js1_``). Unbound actions and empty attributes are covered too — the
extraction must be COMPLETE, so nothing is dropped.
"""

import io
import json
import sys
import types
import xml.etree.ElementTree as ET

from sc_extract.keybinds import parse_default_profile

PROFILE_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<profile version="1" profileName="default">
  <options type="keyboard" instance="1"/>
  <actionmap name="spaceship_movement" UILabel="@ui_CGSpaceFlight" UICategory="@ui_CCSpaceFlight">
    <action name="v_ifcs_toggle_vector_decoupling" ActivationMode="press"
            UILabel="@ui_CIToggleDecoupled" UIDescription="@ui_CIToggleDecoupledDesc"
            keyboard="c" mouse="" joystick="" gamepad=""/>
    <action name="v_strafe_up" ActivationMode="hold" UILabel="@ui_CIStrafeUp" keyboard="space">
      <keyboard/>
    </action>
    <action name="v_view_look_behind" UILabel="@ui_CILookBehind">
      <rebind device="gamepad" input="button_back"/>
    </action>
    <action name="v_target_nearest_hostile" UILabel="@ui_CITargetNearestHostile">
      <rebind input="js1_button18"/>
    </action>
    <action name="v_mouse_aim" UILabel="@ui_CIMouseAim" mouse="maxis_x"/>
    <action name="v_unbound_example" UILabel="@ui_CIUnbound"/>
  </actionmap>
  <actionmap name="ui_notification" UILabel="@ui_CGNotification">
    <action name="ui_expand" UILabel="@ui_CIExpand" keyboard="f1"/>
  </actionmap>
</profile>
"""


def parse():
    return parse_default_profile(PROFILE_XML)


class TestActionmaps:
    def test_all_actionmaps_parsed_in_order(self):
        maps = parse()["actionmaps"]
        assert [m["name"] for m in maps] == ["spaceship_movement", "ui_notification"]

    def test_options_element_is_not_an_actionmap(self):
        # <options> at top level must never be mistaken for an actionmap.
        assert all(m["name"] != "options" for m in parse()["actionmaps"])

    def test_label_and_category_keys(self):
        m = parse()["actionmaps"][0]
        assert m["labelKey"] == "@ui_CGSpaceFlight"
        assert m["categoryKey"] == "@ui_CCSpaceFlight"

    def test_missing_category_is_none(self):
        m = parse()["actionmaps"][1]
        assert m["labelKey"] == "@ui_CGNotification"
        assert m["categoryKey"] is None

    def test_sort_is_document_order(self):
        assert [m["sort"] for m in parse()["actionmaps"]] == [0, 1]


class TestActions:
    def actions(self):
        return parse()["actions"]

    def by_name(self, name):
        return next(a for a in self.actions() if a["name"] == name)

    def test_every_action_kept_including_unbound(self):
        assert [a["name"] for a in self.actions()] == [
            "v_ifcs_toggle_vector_decoupling",
            "v_strafe_up",
            "v_view_look_behind",
            "v_target_nearest_hostile",
            "v_mouse_aim",
            "v_unbound_example",
            "ui_expand",
        ]

    def test_keyboard_attribute_binding(self):
        assert self.by_name("v_ifcs_toggle_vector_decoupling")["bindings"]["keyboard"] == "c"

    def test_empty_attributes_become_none(self):
        b = self.by_name("v_ifcs_toggle_vector_decoupling")["bindings"]
        assert b["mouse"] is None and b["gamepad"] is None and b["joystick"] is None

    def test_label_description_activation(self):
        a = self.by_name("v_ifcs_toggle_vector_decoupling")
        assert a["labelKey"] == "@ui_CIToggleDecoupled"
        assert a["descriptionKey"] == "@ui_CIToggleDecoupledDesc"
        assert a["activationMode"] == "press"

    def test_missing_description_is_none(self):
        assert self.by_name("v_strafe_up")["descriptionKey"] is None

    def test_attribute_wins_over_empty_child(self):
        # <keyboard/> child carries no input → the keyboard="space" attr stands.
        assert self.by_name("v_strafe_up")["bindings"]["keyboard"] == "space"

    def test_rebind_child_with_explicit_device(self):
        assert self.by_name("v_view_look_behind")["bindings"]["gamepad"] == "button_back"

    def test_rebind_child_device_inferred_from_prefix(self):
        assert self.by_name("v_target_nearest_hostile")["bindings"]["joystick"] == "js1_button18"

    def test_mouse_attribute_binding(self):
        assert self.by_name("v_mouse_aim")["bindings"]["mouse"] == "maxis_x"

    def test_unbound_action_has_all_none(self):
        assert self.by_name("v_unbound_example")["bindings"] == {
            "keyboard": None, "mouse": None, "gamepad": None, "joystick": None,
        }

    def test_actionmap_reference(self):
        assert self.by_name("ui_expand")["actionmap"] == "ui_notification"

    def test_global_sort_is_monotonic_from_zero(self):
        sorts = [a["sort"] for a in self.actions()]
        assert sorts == sorted(sorts)
        assert sorts[0] == 0


class TestRobustness:
    def test_empty_bytes(self):
        assert parse_default_profile(b"") == {"actionmaps": [], "actions": []}

    def test_garbage_is_safe(self):
        assert parse_default_profile(b"<not-a-profile/>") == {"actionmaps": [], "actions": []}


class TestCryXmlBinaryDispatch:
    """SC ships defaultProfile.xml as CryXmlB binary, not text. Regression guard:
    magic-prefixed blobs must be routed through the CryXmlB decoder, NOT fed to
    ET.fromstring (which fails "not well-formed" and silently yields 0 actionmaps
    — the original bug). scdatatools is faked so the test stays hermetic.
    """

    def _install_fake_scdatatools(self, monkeypatch, tree_or_exc):
        def etree_from_cryxml_file(source):
            if isinstance(tree_or_exc, Exception):
                raise tree_or_exc
            return tree_or_exc

        root = types.ModuleType("scdatatools")
        engine = types.ModuleType("scdatatools.engine")
        cryxml = types.ModuleType("scdatatools.engine.cryxml")
        cryxml.etree_from_cryxml_file = etree_from_cryxml_file
        root.engine = engine
        engine.cryxml = cryxml
        monkeypatch.setitem(sys.modules, "scdatatools", root)
        monkeypatch.setitem(sys.modules, "scdatatools.engine", engine)
        monkeypatch.setitem(sys.modules, "scdatatools.engine.cryxml", cryxml)

    def test_cryxmlb_bytes_are_decoded_not_parsed_as_text(self, monkeypatch):
        # The decoder yields the real tree; the raw bytes are NOT valid text XML,
        # so a pass-through to ET.fromstring would return empty (the bug).
        tree = ET.ElementTree(ET.fromstring(PROFILE_XML))
        self._install_fake_scdatatools(monkeypatch, tree)
        data = parse_default_profile(b"CryXmlB\x00\x6b\xce\x02\x00garbage-binary")
        assert len(data["actionmaps"]) == 2
        assert len(data["actions"]) == 7
        assert data["actions"][0]["bindings"]["keyboard"] == "c"

    def test_cryxmlb_decode_failure_degrades_to_empty(self, monkeypatch):
        self._install_fake_scdatatools(monkeypatch, ValueError("bad blob"))
        assert parse_default_profile(b"CryXmlB\x00bad") == {"actionmaps": [], "actions": []}

    def test_cryxmlb_missing_dependency_degrades_to_empty(self, monkeypatch):
        # scdatatools absent → ImportError inside the branch → graceful empty.
        for mod in ("scdatatools", "scdatatools.engine", "scdatatools.engine.cryxml"):
            monkeypatch.setitem(sys.modules, mod, None)
        assert parse_default_profile(b"CryXmlB\x00x") == {"actionmaps": [], "actions": []}


class _FakeP4K:
    """Minimal duck-typed P4K: namelist/getinfo/open over an in-memory dict."""

    def __init__(self, files):
        self._files = dict(files)

    def namelist(self):
        return list(self._files)

    def getinfo(self, name):
        return name

    def open(self, info):
        data = self._files[info]

        class _Ctx:
            def __enter__(self_inner):
                return io.BytesIO(data)

            def __exit__(self_inner, *exc):
                return False

        return _Ctx()


class TestDumpKeybinds:
    def _extractor(self, files, out):
        from sc_extract.dataforge_extract import CodexExtractor
        from sc_extract.localization import Localizer

        return CodexExtractor(
            None, Localizer.empty(), out,
            {"channel": "LIVE", "patch": "4.x", "build": "1"},
            p4k=_FakeP4K(files), extract_assets=False,
        )

    def test_finds_profile_case_insensitively(self, tmp_path):
        ext = self._extractor({"Data/Libs/Config/defaultProfile.xml": PROFILE_XML}, tmp_path)
        assert ext._find_profile_entry() == "Data/Libs/Config/defaultProfile.xml"

    def test_dump_writes_json_and_counts(self, tmp_path):
        ext = self._extractor({"Data/Libs/Config/defaultProfile.xml": PROFILE_XML}, tmp_path)
        ext.dump_keybinds()
        out = tmp_path / "keybinds" / "keybinds.json"
        assert out.exists()
        data = json.loads(out.read_text(encoding="utf-8"))
        assert len(data["actions"]) == 7
        assert len(data["actionmaps"]) == 2
        assert ext.counts["keybinds"] == 7

    def test_missing_profile_is_graceful(self, tmp_path):
        ext = self._extractor({"Data/Other/file.txt": b"x"}, tmp_path)
        ext.dump_keybinds()
        assert "keybinds" not in ext.counts
        assert not (tmp_path / "keybinds").exists()

    def test_no_p4k_is_noop(self, tmp_path):
        from sc_extract.dataforge_extract import CodexExtractor
        from sc_extract.localization import Localizer

        ext = CodexExtractor(
            None, Localizer.empty(), tmp_path,
            {"channel": "L", "patch": "4", "build": "1"},
            p4k=None, extract_assets=False,
        )
        ext.dump_keybinds()
        assert "keybinds" not in ext.counts
