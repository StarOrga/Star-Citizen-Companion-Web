"""Tests for the plausibility validator thresholds.

Run via: python -m pytest data-uploader/python/tests/
"""

import pytest

from sc_extract.thresholds import (
    COUNTER_THRESHOLDS,
    aggregate_score,
    heuristic_check_entity,
    score_count,
)


class TestScoreCount:
    def test_at_or_above_expected_is_100(self):
        assert score_count("ships", 180) == 100.0
        assert score_count("ships", 300) == 100.0

    def test_unknown_counter_is_100(self):
        assert score_count("unknown_thing", 0) == 100.0

    def test_between_warning_and_expected(self):
        # ships: warning=150, expected=180 → at 165 should be ~80
        s = score_count("ships", 165)
        assert 75 <= s <= 85

    def test_between_red_and_warning(self):
        # ships: red=100, warning=150 → at 125 should be ~45
        s = score_count("ships", 125)
        assert 40 <= s <= 50

    def test_below_red(self):
        s = score_count("ships", 50)
        assert 0 <= s < 30

    def test_zero(self):
        assert score_count("ships", 0) == 0.0


class TestAggregateScore:
    def test_empty_counts(self):
        score, warnings = aggregate_score({})
        assert score == 0.0
        assert "no entities" in warnings[0]

    def test_all_above_expected(self):
        counts = {key: th.expected + 50 for key, th in COUNTER_THRESHOLDS.items()}
        score, warnings = aggregate_score(counts)
        assert score == 100.0
        assert not warnings

    def test_one_below_warning_drags_aggregate(self):
        # ships fine, weapons below warning
        counts = {"ships": 200, "weapons": 180}
        score, warnings = aggregate_score(counts)
        assert score < 100
        assert any("weapons" in w for w in warnings)


class TestHeuristicCheckEntity:
    def test_ship_all_fields_present(self):
        ship = {"name": "AEGS_Gladius", "mass": 56000, "hp_main_hull": 12000}
        assert heuristic_check_entity("ship", ship) == []

    def test_ship_missing_mass(self):
        ship = {"name": "AEGS_Gladius", "hp_main_hull": 12000}
        warnings = heuristic_check_entity("ship", ship)
        assert len(warnings) == 1
        assert "mass" in warnings[0]
        assert "AEGS_Gladius" in warnings[0]

    def test_ship_zero_hp_is_missing(self):
        # 0 counts as missing for the heuristic — per Iter-2-comment "nullable/0"
        ship = {"name": "X", "mass": 1000, "hp_main_hull": 0}
        warnings = heuristic_check_entity("ship", ship)
        assert any("hp_main_hull" in w for w in warnings)

    def test_unknown_entity_type_no_warnings(self):
        assert heuristic_check_entity("alien_artifact", {"name": "X"}) == []
