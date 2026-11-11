"""Sustained-fire cycle scalars on the weapon payload (admin feedback #343).

Energy weapons drain an ammo pool that regenerates after a cooldown; every gun
can overheat. Both structs are nested under SCItemWeaponComponentParams and
were dropped by the flat scalar copy, so the codex showed sustained DPS equal
to burst DPS. `_weapon_cycle_params` copies their numeric scalars verbatim
under `regen.` / `heat.` and emits nothing for a weapon without them.
"""

from __future__ import annotations

from sc_extract.dataforge_extract import _weapon_cycle_params


def test_energy_regen_and_heat_are_flattened() -> None:
    wcp = {
        "weaponRegenConsumerParams": {
            "_Type_": "SWeaponRegenConsumerParams",
            "requestedRegenPerSec": 30.0,
            "regenerationCooldown": 0.5,
            "regenerationCostPerBullet": 1.0,
            "maxAmmoLoad": 60,
            "someFlag": True,
            "nested": {"x": 1},
        },
        "connectionParams": {
            "simplifiedHeatParams": {
                "overheatTemperature": 100.0,
                "minTemperature": 0.0,
                "overheatFixTime": 2.0,
            },
        },
    }
    out = _weapon_cycle_params(wcp)
    assert out == {
        "regen.requestedRegenPerSec": 30.0,
        "regen.regenerationCooldown": 0.5,
        "regen.regenerationCostPerBullet": 1.0,
        "regen.maxAmmoLoad": 60.0,
        "heat.overheatTemperature": 100.0,
        "heat.minTemperature": 0.0,
        "heat.overheatFixTime": 2.0,
    }


def test_weapon_without_cycle_structs_emits_nothing() -> None:
    assert _weapon_cycle_params({"weaponRegenConsumerParams": None, "fireRate": 200}) == {}
