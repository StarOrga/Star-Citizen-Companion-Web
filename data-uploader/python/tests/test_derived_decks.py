"""Decks derived from floor levels for a hull that authors none (Idris).

VERIFIED LIVE 4.10.2: AEGS_Idris_M / _P carry no interiorMapSection, so all
129 rooms sat on one "All rooms" deck. Their floors cluster into levels; stairs,
ladders and lifts join every level they connect.
"""

from __future__ import annotations

from sc_extract.ship_rooms import derive_levels, is_connector


def _room(key: str, floor, height=4.0, z=None):
    return {"key": key, "floorZ": floor, "height": height,
            "pos": [0.0, 0.0, z if z is not None else (floor or 0.0) + 1.5]}


def _derive(rooms):
    conn = [is_connector(r["key"]) for r in rooms]
    return derive_levels(rooms, conn)


def test_stairwell_singular_is_a_connector_the_stairwells_area_is_not() -> None:
    assert is_connector("Hangar_LeftStairwell_Lower_Room1")
    assert is_connector("RightStairwells_Stairs_Room1")
    assert is_connector("MidDeck_Rear_Bridge_Elevator")
    assert is_connector("ArgoBay_AccessLadder_Left_Room1")
    assert is_connector("Room_X", "Elevator")
    # The Idris files a whole area as "Left_Stairwells_…": that is a brig.
    assert not is_connector("Left_Stairwells_Brig_Room")
    assert not is_connector("MidDeck_Center_Messhall_Room")


def test_floors_cluster_into_levels_bottom_up() -> None:
    rooms = [_room("Hangar_A", -9.75), _room("Hangar_B", -9.0),
             _room("Main_A", 5.0), _room("Main_B", 5.38), _room("Main_C", 5.88),
             _room("Bridge_A", 17.25), _room("Bridge_B", 17.97)]
    levels, assign = _derive(rooms)
    assert [lv["floor"] for lv in levels] == [-9.38, 5.38, 17.61]
    assert assign == [[0], [0], [1], [1], [1], [2], [2]]


def test_a_stair_belongs_to_every_level_it_connects() -> None:
    rooms = [_room("Main_A", 5.0), _room("Main_B", 5.38),
             _room("Upper_A", 9.75), _room("Upper_B", 9.71),
             _room("Bridge_A", 17.25), _room("Bridge_B", 17.97),
             # climbs from 9.25 to 15.4: upper level + the bridge just above its top
             _room("Bridge_LeftStairwell_Room1", 9.25, height=6.15),
             # the lift shaft runs the whole ship
             _room("MidDeck_Rear_Bridge_Elevator", 3.0, height=19.5),
             # a ladder without a volume: the levels around its pivot
             _room("Upper_AccessLadder", None, height=None, z=8.0)]
    levels, assign = _derive(rooms)
    assert len(levels) == 3
    assert assign[6] == [1, 2]
    assert assign[7] == [0, 1, 2]
    assert assign[8] == [0, 1]


def test_a_single_raised_room_is_no_level() -> None:
    rooms = [_room("Cabin_A", 0.0), _room("Cabin_B", 0.2), _room("Cockpit", 1.9)]
    assert _derive(rooms) is None


def test_stairs_never_seed_a_level() -> None:
    rooms = [_room("Main_A", 5.0), _room("Main_B", 5.2),
             _room("X_Stairwell_A", 9.0), _room("X_Stairwell_B", 9.1)]
    assert _derive(rooms) is None
