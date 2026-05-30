"""Build a tiny subset of a REAL Data.p4k for local dev tests.

NEVER COMMIT THE OUTPUT — it contains CIG copyrighted content. The repo's
.gitignore excludes data-uploader/python/tests/fixtures/real-subset.*.

Phase 2 § F2 — Layer 2 fixture. Use this when you need to verify the real
scdatatools wiring works, not just the validator/scoring layer.

Usage:
    python data-uploader/python/scripts/build-subset-fixture.py \\
        --p4k 'C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\Data.p4k' \\
        --out data-uploader/python/tests/fixtures/real-subset.p4k \\
        --include 'Data/Objects/Spaceships/AEGS_*' \\
        --include 'Data/Game.dcb' \\
        --max-files 30 \\
        --max-bytes 50000000
"""

from __future__ import annotations

import argparse
import fnmatch
import sys
import zipfile
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Subset a real Data.p4k for testing")
    parser.add_argument("--p4k", type=Path, required=True, help="Source Data.p4k")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("data-uploader/python/tests/fixtures/real-subset.p4k"),
    )
    parser.add_argument(
        "--include",
        action="append",
        default=[],
        help="Glob pattern to include (repeatable). Default: a small AEGS-only set.",
    )
    parser.add_argument(
        "--max-files",
        type=int,
        default=50,
        help="Hard cap on number of files to copy (default 50)",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=50 * 1024 * 1024,
        help="Hard cap on output size in bytes (default 50 MB)",
    )
    args = parser.parse_args()

    if not args.p4k.exists():
        print(f"ERROR: source not found: {args.p4k}", file=sys.stderr)
        return 1

    patterns = args.include or [
        "Data/Game.dcb",
        "Data/Objects/Spaceships/AEGS_Gladius*",
        "Data/Objects/Spaceships/AEGS_Avenger_Titan*",
        "Data/Localization/english/global.ini",
    ]

    args.out.parent.mkdir(parents=True, exist_ok=True)

    written_files = 0
    written_bytes = 0
    with zipfile.ZipFile(args.p4k, "r") as src:
        names = src.namelist()
        matched = [n for n in names if any(fnmatch.fnmatch(n, p) for p in patterns)]
        print(f"[subset] {len(matched)} matches for patterns: {patterns}")

        with zipfile.ZipFile(args.out, "w", compression=zipfile.ZIP_DEFLATED) as dst:
            for name in matched:
                if written_files >= args.max_files:
                    print(f"[subset] cap reached: {args.max_files} files — stopping")
                    break
                with src.open(name) as fp:
                    payload = fp.read()
                if written_bytes + len(payload) > args.max_bytes:
                    print(
                        f"[subset] cap reached: would exceed {args.max_bytes/1024/1024:.0f} MB — stopping at {name}"
                    )
                    break
                dst.writestr(name, payload)
                written_files += 1
                written_bytes += len(payload)

    print(
        f"[subset] wrote {args.out} ({written_files} files, "
        f"{written_bytes/1024/1024:.1f} MB) — DO NOT COMMIT"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
