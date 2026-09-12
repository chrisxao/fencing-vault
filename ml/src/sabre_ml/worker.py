from __future__ import annotations

import argparse
import json
from pathlib import Path

from .dataset import leakage_safe_split, load_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Sabre Studio model worker scaffold")
    parser.add_argument("manifest", type=Path, help="Dataset JSON exported by the web app")
    parser.add_argument("--check", action="store_true", help="Validate and print leakage-safe folds")
    args = parser.parse_args()
    manifest = load_manifest(args.manifest)
    if args.check:
        print(json.dumps(leakage_safe_split(manifest), indent=2))
        return
    raise SystemExit("Model adapters are intentionally stage-gated. Configure a baseline in ml/configs first.")


if __name__ == "__main__":
    main()
