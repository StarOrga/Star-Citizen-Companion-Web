"""Which entity records count as a vehicle for the `ships/` projection.

Regression guard for the bug where the classifier used a single
``libs/foundry/records/entities/spaceships/`` prefix and therefore dropped every
GROUND vehicle in the game (the live datacore files those under
``entities/groundvehicles/``: 40 records vs 920 spaceships). The visible symptom
was two directories away: URSA, Cyclone, Storm, ROC, PTV/STV/UTV, ATLS, Nox, X1
… never reached ``codex_ships``, so the app had neither an entry nor artwork for
them and the RSI diff listed them as "flight-ready but missing".
"""

from __future__ import annotations

from sc_extract.dataforge_extract import (
    _VEHICLE_COMPONENT,
    _VEHICLE_ROOT_RE,
    _find_component,
    _norm_path,
)


def _is_vehicle_path(filename: str) -> bool:
    return bool(_VEHICLE_ROOT_RE.search(_norm_path(filename)))


def test_spaceship_records_are_vehicles() -> None:
    assert _is_vehicle_path("libs/foundry/records/entities/spaceships/aegs/aegs_gladius.xml")


def test_ground_vehicle_records_are_vehicles() -> None:
    # The regression: these were silently dropped from the ship catalog.
    for path in (
        "libs/foundry/records/entities/groundvehicles/rsi/rsi_ursa.xml",
        "libs/foundry/records/entities/groundvehicles/tmbl/tmbl_cyclone.xml",
        "libs/foundry/records/entities/groundvehicles/grin/grin_roc.xml",
    ):
        assert _is_vehicle_path(path), path


def test_generic_vehicles_root_is_accepted() -> None:
    assert _is_vehicle_path("libs/foundry/records/entities/vehicles/orig/orig_x1.xml")


def test_backslashes_and_case_are_normalised() -> None:
    assert _is_vehicle_path("Libs\\Foundry\\Records\\Entities\\GroundVehicles\\RSI\\RSI_Ursa.xml")


def test_non_vehicle_records_are_not_vehicles() -> None:
    for path in (
        "libs/foundry/records/entities/scitem/ships/cargogrid/gama_syulen_cargogrid.xml",
        "libs/foundry/records/entities/commodities/vice/freeze.xml",
        "libs/foundry/records/entities/scitem/vehicles/seataccess/rsi_lynx_seataccess.xml",
        "",
    ):
        assert not _is_vehicle_path(path), path


def test_vehicle_component_is_the_off_root_fallback() -> None:
    """A vehicle filed outside the known roots is still caught by its component."""
    comps = [{"_Type_": "SGeometryResourceParams"}, {"_Type_": _VEHICLE_COMPONENT}]
    assert _find_component(comps, _VEHICLE_COMPONENT) is not None
    assert _find_component([{"_Type_": "SAttachableComponentParams"}], _VEHICLE_COMPONENT) is None
