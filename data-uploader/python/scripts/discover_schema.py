"""Discovery dump (research Q2/Q4): open the live DataCore via our pure-Python
DataForge v8 reader and reconcile the real schema against the research §1.3.

Outputs sc_extract/datacore_schema.json. Run against the live P4K:
    python -m scripts.discover_schema
"""
from __future__ import annotations

import json
import sys
import time
from collections import Counter
from pathlib import Path

from sc_extract.p4k_compat import apply_p4k_compat
from sc_extract.dataforge import DataForge

P4K = r"C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k"
OUT = Path(__file__).resolve().parent.parent / "sc_extract" / "datacore_schema.json"


def find_dcb_entry(p4k):
    for n in p4k.namelist():
        if n.lower().endswith(".dcb"):
            return n
    raise RuntimeError("no .dcb entry in P4K")


def main() -> int:
    assert apply_p4k_compat()
    from scdatatools.p4k import P4KFile

    t0 = time.time()
    p4k = P4KFile(P4K)
    print(f"p4k opened in {time.time()-t0:.1f}s, entries={len(p4k.namelist())}")

    dcb_entry = find_dcb_entry(p4k)
    info = p4k.getinfo(dcb_entry)
    print(f"datacore entry: {dcb_entry}  size={info.file_size}")

    t1 = time.time()
    with p4k.open(info) as f:
        raw = f.read()
    print(f"read+decompress dcb {len(raw)} bytes in {time.time()-t1:.1f}s")

    t2 = time.time()
    df = DataForge(raw)
    print(f"DataForge v{df.version} parsed in {time.time()-t2:.1f}s; "
          f"records={len(df.records)}")

    type_hist = Counter(r.type for r in df.records)

    # component param histogram + entity path buckets over EntityClassDefinition
    comp_hist = Counter()
    path_buckets = Counter()
    tag_hist = Counter()
    sample_entities = []
    n_entities = 0
    t3 = time.time()
    for r in df.records_by_type_name("EntityClassDefinition"):
        n_entities += 1
        tag_hist[r.tag or "<none>"] += 1
        fn = (r.filename or "").lower().replace("\\", "/")
        parts = fn.split("/")
        if "entities" in parts:
            i = parts.index("entities")
            path_buckets["/".join(parts[i : i + 2])] += 1
        if len(sample_entities) < 40:
            sample_entities.append(r.filename)
        # resolve shallow to read component struct names cheaply
        d = df.record_to_dict(r, max_depth=4)
        comps = d.get("_RecordValue_", {}).get("Components")
        if isinstance(comps, list):
            for c in comps:
                if isinstance(c, dict):
                    comp_hist[c.get("_Type_", "?")] += 1
    print(f"entity scan ({n_entities}) in {time.time()-t3:.1f}s")

    out = {
        "dcb_entry": dcb_entry,
        "dataforge_version": df.version,
        "n_records": len(df.records),
        "n_entity_class_definitions": n_entities,
        "record_types_count": len(df.record_types),
        "record_types": sorted(df.record_types),
        "record_type_histogram": dict(type_hist.most_common()),
        "entity_tag_histogram": dict(tag_hist.most_common()),
        "component_param_histogram": dict(comp_hist.most_common()),
        "entity_path_buckets": dict(path_buckets.most_common()),
        "sample_entity_filenames": sample_entities,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {OUT}")

    print("\n=== top 30 record types ===")
    for t, c in type_hist.most_common(30):
        print(f"  {c:7d}  {t}")
    print("\n=== component param histogram (top 40) ===")
    for t, c in comp_hist.most_common(40):
        print(f"  {c:7d}  {t}")
    print("\n=== entity path buckets ===")
    for t, c in path_buckets.most_common(40):
        print(f"  {c:7d}  {t}")
    print("\n=== entity tag histogram ===")
    for t, c in tag_hist.most_common():
        print(f"  {c:7d}  {t}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
