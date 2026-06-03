"""Fetch the external *build tool* binaries the 3D hull export needs.

These are NOT data sources — all SC data comes from the local Data.p4k. These
are geometry/optimization tools that are too large to commit:

  * cgf-converter (Markemp/Cryengine-Converter) — converts SC 4.x Ivo .cga/.cgf
    geometry (which scdatatools 1.0.4 cannot parse) to glTF. v2.0.0 is required
    for SC 4.x; v1.7.1 fails silently (empty glb).

`@gltf-transform/cli` is fetched on demand via `npx`, so it is not handled here.

Usage:
    python tools/fetch_tools.py            # downloads to ./tools/
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

TOOLS = Path(__file__).resolve().parent

# pinned: v2.0.0 standalone exe — the first release that parses SC 4.x Ivo meshes
CGF_CONVERTER_URL = (
    "https://github.com/Markemp/Cryengine-Converter/releases/download/"
    "v2.0.0/cgf-converter.exe"
)
CGF_CONVERTER_DEST = TOOLS / "cgf-converter-2.exe"
CGF_CONVERTER_MIN_BYTES = 100_000_000  # ~117 MB self-contained .NET binary


def _download(url: str, dest: Path, min_bytes: int) -> None:
    if dest.exists() and dest.stat().st_size >= min_bytes:
        print(f"[skip] {dest.name} already present ({dest.stat().st_size:,} B)")
        return
    print(f"[get ] {url}\n   -> {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:  # noqa: S310
        while chunk := r.read(1 << 20):
            f.write(chunk)
    if tmp.stat().st_size < min_bytes:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"download too small ({tmp.stat().st_size} B) — aborted")
    tmp.replace(dest)
    print(f"[ok  ] {dest.name} ({dest.stat().st_size:,} B)")


def main() -> int:
    TOOLS.mkdir(parents=True, exist_ok=True)
    _download(CGF_CONVERTER_URL, CGF_CONVERTER_DEST, CGF_CONVERTER_MIN_BYTES)
    print("\nAll build tools ready. (gltf-transform is fetched via `npx` at runtime.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
