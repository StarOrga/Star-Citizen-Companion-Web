"""Pure-Counter Plausibility-Validator thresholds.

Per concept Iter 3 § II — User accepted these thresholds.
Plus minimal per-entity Heuristik (Iter-3-comment: "nur ein paar wenige Sub-Daten"):
only the most important fields are null-checked per entity, not the full schema.
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass(frozen=True)
class Threshold:
    """Expected count, warning floor, red floor."""

    expected: int
    warning: int
    red: int


COUNTER_THRESHOLDS: Dict[str, Threshold] = {
    "ships": Threshold(expected=180, warning=150, red=100),
    "weapons": Threshold(expected=250, warning=200, red=150),
    "components": Threshold(expected=600, warning=500, red=350),
    "items": Threshold(expected=1500, warning=1200, red=800),
    "strings": Threshold(expected=50_000, warning=40_000, red=25_000),
}

# Per-entity minimal heuristic — only the absolute-must fields, per
# user-comment Iter 3: "nur ein paar wenige Sub-Daten".
MINIMAL_REQUIRED_FIELDS: Dict[str, List[str]] = {
    "ship": ["name", "mass", "hp_main_hull"],
    "weapon": ["name", "size", "damage_per_shot"],
    "component": ["name", "size", "type"],
    "item": ["name"],
}


def score_count(counter_key: str, value: int) -> float:
    """0-100 score based on observed count vs. threshold.

    >>> score_count("ships", 200)
    100.0
    >>> score_count("ships", 120)  # below warning
    66.67
    """
    th = COUNTER_THRESHOLDS.get(counter_key)
    if not th:
        return 100.0  # unknown counter — don't penalize
    if value >= th.expected:
        return 100.0
    if value >= th.warning:
        # linear between warning and expected
        return 60.0 + 40.0 * (value - th.warning) / (th.expected - th.warning)
    if value >= th.red:
        return 30.0 + 30.0 * (value - th.red) / (th.warning - th.red)
    return max(0.0, 30.0 * value / max(th.red, 1))


def aggregate_score(counts: Dict[str, int]) -> Tuple[float, List[str]]:
    """Return (aggregate_score, list_of_warnings).

    Aggregate = min of all individual counter scores (the weakest signal wins).
    """
    if not counts:
        return 0.0, ["no entities extracted"]

    scored = [(key, value, score_count(key, value)) for key, value in counts.items()]
    aggregate = min(s for _, _, s in scored)
    warnings: List[str] = []
    for key, value, s in scored:
        th = COUNTER_THRESHOLDS.get(key)
        if th and value < th.warning:
            warnings.append(
                f"{key}={value} below expected ({th.expected}) — score {s:.0f}/100"
            )
    return round(aggregate, 2), warnings


def heuristic_check_entity(
    entity_type: str, entity_dict: Dict[str, object]
) -> List[str]:
    """Return list of warnings for missing required fields.

    Only checks the minimal set (MINIMAL_REQUIRED_FIELDS) — not the full schema.
    """
    required = MINIMAL_REQUIRED_FIELDS.get(entity_type, [])
    warnings = []
    for field in required:
        if entity_dict.get(field) in (None, "", 0):
            name = entity_dict.get("name", "<unknown>")
            warnings.append(f"{entity_type} '{name}': missing/empty {field}")
    return warnings
