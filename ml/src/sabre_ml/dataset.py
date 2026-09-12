from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def load_manifest(path: str | Path) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if value.get("schemaVersion") != 1:
        raise ValueError("Unsupported Sabre Studio dataset schema")
    if not value.get("rulesetId"):
        raise ValueError("Dataset export is missing its ruleset")
    return value


def leakage_safe_split(manifest: dict[str, Any], folds: int = 5) -> dict[str, list[str]]:
    """Group by tournament, then fencer pair, so adjacent phrases never cross splits."""
    groups: dict[str, list[str]] = defaultdict(list)
    for bout in manifest.get("bouts", []):
        fencers = sorted(filter(None, [bout.get("leftFencer", {}).get("id"), bout.get("rightFencer", {}).get("id")]))
        group = bout.get("tournamentName") or ":".join(fencers) or bout["id"]
        groups[group].append(bout["id"])
    result = {f"fold_{index}": [] for index in range(folds)}
    for group, bout_ids in groups.items():
        index = int(hashlib.sha256(group.encode()).hexdigest()[:8], 16) % folds
        result[f"fold_{index}"].extend(bout_ids)
    return result
