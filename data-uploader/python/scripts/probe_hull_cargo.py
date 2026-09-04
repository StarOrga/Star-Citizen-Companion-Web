"""One-off verification probe: hull HP/mass, armour HP, cargo SCU per ship.

Not part of the extract pipeline - run manually against a live Data.p4k to
verify the figures the extractor emits (see
docs/concepts/codex-extraction-output.md).

    python scripts/probe_hull_cargo.py "<path to Data.p4k>" [SHIP ...]
"""
import io
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sc_extract.p4k_compat import apply_p4k_compat  # noqa: E402

SHIPS = sys.argv[2:] or ["CNOU_Nomad", "AEGS_Gladius", "MISC_Freelancer",
                         "DRAK_Cutlass_Black", "ANVL_Carrack", "AEGS_Idris_P",
                         "AEGS_Hammerhead"]
P4K = sys.argv[1]

apply_p4k_compat()
from scdatatools.p4k import P4KFile  # noqa: E402
from sc_extract.dataforge import DataForge  # noqa: E402

p4k = P4KFile(P4K)
names = p4k.namelist()
lower = {n.lower(): n for n in names}
dcb = next(n for n in names if n.lower().endswith(".dcb"))
with p4k.open(p4k.getinfo(dcb)) as f:
    raw = f.read()
df = DataForge(raw)
print("records", len(df.records), file=sys.stderr)


def read(path):
    path = path.replace("\\", "/")
    for cand in (path, "Data/" + path):
        real = lower.get(cand.lower())
        if real:
            with p4k.open(p4k.getinfo(real)) as f:
                return f.read()
    return None


def xml_root(blob):
    if blob[:7] == b"CryXmlB":
        from scdatatools.engine.cryxml import etree_from_cryxml_file
        return etree_from_cryxml_file(io.BytesIO(blob)).getroot()
    import xml.etree.ElementTree as ET
    return ET.fromstring(blob)


ecd = {}
for rec in df.records_by_type_name("EntityClassDefinition"):
    ecd.setdefault(rec.name.split(".", 1)[-1].lower(), rec)

out = {}
for ship in SHIPS:
    rec = ecd.get(ship.lower())
    info = {"ship": ship}
    if rec is None:
        out[ship] = {"error": "no record"}
        continue
    d = df.record_to_dict(rec, max_depth=12)
    comps = d.get("_RecordValue_", {}).get("Components") or []
    vcp = next((c for c in comps if c.get("_Type_") == "VehicleComponentParams"), {})
    info["career"] = vcp.get("vehicleCareer")
    info["role"] = vcp.get("vehicleRole")
    vdef = vcp.get("vehicleDefinition")
    info["vehicleDefinition"] = vdef
    blob = read(vdef) if vdef else None
    if blob:
        root = xml_root(blob)
        total = 0.0
        n = 0
        mass = None
        for part in root.iter("Part"):
            dm = part.get("damageMax")
            if dm:
                try:
                    total += float(dm)
                    n += 1
                except ValueError:
                    pass
            if (part.get("name") or "").lower() == ship.lower() and part.get("mass"):
                mass = float(part.get("mass"))
        info["hullHp"] = total
        info["hullParts"] = n
        info["mass"] = mass
        info["partNames"] = [p.get("name") for p in list(root.iter("Part"))[:5]]
    arec = ecd.get(("ARMR_" + ship).lower())
    if arec is not None:
        ad = df.record_to_dict(arec, max_depth=8)
        acomps = ad.get("_RecordValue_", {}).get("Components") or []
        h = next((c for c in acomps if c.get("_Type_") == "SHealthComponentParams"), {})
        info["armorHp"] = h.get("Health")
    dl = next((c for c in comps
               if c.get("_Type_") == "SEntityComponentDefaultLoadoutParams"), {})
    entries = ((dl.get("loadout") or {}).get("entries") or [])
    cargo_classes = [e.get("entityClassName") for e in entries
                     if "cargo" in (e.get("itemPortName") or "").lower()
                     or "cargo" in (e.get("entityClassName") or "").lower()]
    info["cargoClasses"] = cargo_classes
    grids = []
    for cc in cargo_classes:
        crec = ecd.get((cc or "").lower())
        if crec is None:
            continue
        cd = df.record_to_dict(crec, max_depth=10)
        ccomps = cd.get("_RecordValue_", {}).get("Components") or []
        grids.append([c for c in ccomps
                      if "nventory" in (c.get("_Type_") or "")
                      or "argo" in (c.get("_Type_") or "")])
    info["cargoComps"] = grids
    out[ship] = info

Path(sys.argv[0]).with_name("probe_hull_cargo_out.json").write_text(
    json.dumps(out, indent=1, default=str), encoding="utf-8")
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "cargoComps"}
                  for k, v in out.items()}, indent=1, default=str))
