"""Parse SC ``Data/Libs/Config/defaultProfile.xml`` into keybinding records.

The default action profile groups actions into ``<actionmap>``s; each
``<action>`` carries UI label/description ``@``-keys and its default per-device
bindings. Bindings appear in two shapes across SC builds, both handled here:

  * attribute form:   ``<action keyboard="c" mouse="maxis_x" .../>``
  * rebind children:  ``<rebind device="gamepad" input="button_back"/>`` and
                      ``<rebind input="js1_button18"/>`` (device from the prefix)

Only the four input devices we surface are kept: keyboard, mouse, gamepad,
joystick. Empty strings mean "no default" and normalise to ``None``. Unbound
actions are KEPT — the reference must be complete. Labels stay as raw ``@``-keys;
they resolve against ``codex_locale_strings`` (all languages) client-side, so no
translation happens here.
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional

DEVICES = ("keyboard", "mouse", "gamepad", "joystick")

# SC ships defaultProfile.xml as CryEngine binary XML (CryXmlB). Plain
# ``ET.fromstring`` chokes on it ("not well-formed") and silently yields zero
# actionmaps. The 7-byte magic lets us route binary blobs through scdatatools'
# CryXmlB decoder while keeping plain-text profiles (and the unit-test fixtures)
# on the stdlib path — so the module stays importable without scdatatools.
_CRYXMLB_MAGIC = b"CryXmlB"

# rebind input prefix -> device, used when a <rebind> omits an explicit device.
_PREFIX_DEVICE = {
    "kb": "keyboard",
    "mo": "mouse",
    "gp": "gamepad",
    "js": "joystick",
}


def _clean(v: Optional[str]) -> Optional[str]:
    """Trim; empty/whitespace-only → None (SC uses "" for "no default")."""
    if v is None:
        return None
    v = v.strip()
    return v or None


def _device_from_input(inp: str) -> Optional[str]:
    """Infer the device from a rebind input token's prefix (kb1_, js2_, …)."""
    return _PREFIX_DEVICE.get(inp[:2].lower())


def _action_bindings(action: ET.Element) -> Dict[str, Optional[str]]:
    """Resolve one action's default binding per device (None when unbound)."""
    bindings: Dict[str, Optional[str]] = {d: None for d in DEVICES}

    # 1) attribute form takes precedence: keyboard="c" mouse="maxis_x" ...
    for dev in DEVICES:
        val = _clean(action.get(dev))
        if val is not None:
            bindings[dev] = val

    # 2) <rebind> children — explicit device attr, else inferred from the prefix.
    #    Never overwrites a value already set by the attribute form.
    for rebind in action.findall("rebind"):
        inp = _clean(rebind.get("input"))
        if inp is None:
            continue
        dev = _clean(rebind.get("device")) or _device_from_input(inp)
        if dev in DEVICES and bindings.get(dev) is None:
            bindings[dev] = inp

    return bindings


def _parse_root(xml_bytes: bytes) -> Optional[ET.Element]:
    """Return the profile root element from either CryXmlB-binary or text XML.

    CryXmlB blobs are decoded via scdatatools (lazy-imported so the text path
    needs no third-party deps). Any parse failure returns ``None`` so the caller
    can degrade to empty lists instead of aborting the extract.
    """
    if xml_bytes[:len(_CRYXMLB_MAGIC)] == _CRYXMLB_MAGIC:
        try:
            from scdatatools.engine.cryxml import etree_from_cryxml_file
            return etree_from_cryxml_file(io.BytesIO(xml_bytes)).getroot()
        except Exception:  # noqa: BLE001 — missing dep or malformed blob → degrade
            return None
    try:
        return ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None


def parse_default_profile(xml_bytes: bytes) -> Dict[str, List[dict]]:
    """Parse a defaultProfile.xml blob → ``{actionmaps: [...], actions: [...]}``.

    Accepts both the CryXmlB-binary form SC ships and plain-text XML. Malformed
    or empty input yields empty lists rather than raising, so a bad or missing
    profile degrades gracefully instead of aborting the whole extract.
    """
    empty: Dict[str, List[dict]] = {"actionmaps": [], "actions": []}
    if not xml_bytes or not xml_bytes.strip():
        return empty
    root = _parse_root(xml_bytes)
    if root is None:
        return empty

    actionmaps: List[dict] = []
    actions: List[dict] = []
    map_sort = 0
    action_sort = 0

    for am in root.findall("actionmap"):
        name = _clean(am.get("name"))
        if name is None:
            continue
        actionmaps.append({
            "name": name,
            "labelKey": _clean(am.get("UILabel")),
            "categoryKey": _clean(am.get("UICategory")),
            "sort": map_sort,
        })
        map_sort += 1
        for a in am.findall("action"):
            a_name = _clean(a.get("name"))
            if a_name is None:
                continue
            actions.append({
                "actionmap": name,
                "name": a_name,
                "labelKey": _clean(a.get("UILabel")),
                "descriptionKey": _clean(a.get("UIDescription")),
                "activationMode": _clean(a.get("ActivationMode")),
                "bindings": _action_bindings(a),
                "sort": action_sort,
            })
            action_sort += 1

    return {"actionmaps": actionmaps, "actions": actions}
