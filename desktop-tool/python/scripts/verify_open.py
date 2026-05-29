"""GATING VERIFICATION: open the live P4K via the compat patch, prove dcb access."""
from __future__ import annotations

import sys

from sc_extract.p4k_compat import apply_p4k_compat

P4K = r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k"


def main() -> int:
    assert apply_p4k_compat(), "scdatatools not importable"
    from scdatatools.p4k import P4KFile

    p4k = P4KFile(P4K)
    names = p4k.namelist()
    print(f"OPENED OK. namelist len = {len(names)}")

    # find the datacore (case-insensitive)
    dcb_matches = [n for n in names if n.lower().endswith("game.dcb")]
    print("game.dcb matches:", dcb_matches[:10])

    # also: any .dcb at all
    all_dcb = [n for n in names if n.lower().endswith(".dcb")]
    print(f"total .dcb entries: {len(all_dcb)} -> {all_dcb[:10]}")

    # localization files
    loc = [n for n in names if n.lower().endswith("global.ini")]
    print(f"global.ini files: {loc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
