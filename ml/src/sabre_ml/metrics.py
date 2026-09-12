from __future__ import annotations

from collections.abc import Iterable


def boundary_match(predicted_ms: int, actual_ms: int, tolerance_ms: int = 100) -> bool:
    return abs(predicted_ms - actual_ms) <= tolerance_ms


def temporal_iou(predicted: tuple[int, int], actual: tuple[int, int]) -> float:
    intersection = max(0, min(predicted[1], actual[1]) - max(predicted[0], actual[0]))
    union = max(predicted[1], actual[1]) - min(predicted[0], actual[0])
    return intersection / union if union else 0.0


def abstention_accuracy(calls: Iterable[tuple[str, str, bool]]) -> dict[str, float]:
    rows = list(calls)
    decided = [row for row in rows if not row[2]]
    correct = sum(predicted == actual for predicted, actual, _ in decided)
    return {
        "coverage": len(decided) / len(rows) if rows else 0.0,
        "selective_accuracy": correct / len(decided) if decided else 0.0,
    }
