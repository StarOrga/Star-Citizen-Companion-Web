"""Item-port flags reach the catalog (feedback 4263fed1).

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/

The DataCore writes ``SItemPortDef.Flags`` as one whitespace-separated string
(``"invisible $uneditable"`` on the Nomad's life-support port, verified against
LIVE 4.10). The list-only reading dropped every flag on the floor, so the
``codex_item_ports.flags`` column was always ``[]`` — and the web side had no
way to tell an ``invisible`` bay (one the game never shows the pilot) from a
regular one.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import _as_list


def test_flag_string_is_split_into_tokens() -> None:
    assert _as_list("invisible $uneditable") == ["invisible", "$uneditable"]
    assert _as_list("dockingport1 uneditable") == ["dockingport1", "uneditable"]


def test_flag_string_tolerates_commas_and_padding() -> None:
    assert _as_list("  editable, left ") == ["editable", "left"]


def test_empty_and_missing_flags_stay_empty() -> None:
    assert _as_list("") == []
    assert _as_list("   ") == []
    assert _as_list(None) == []


def test_list_form_is_kept_token_by_token() -> None:
    assert _as_list(["uneditable", {"_Type_": "x"}, 3]) == ["uneditable", "3"]
