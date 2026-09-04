"""One-off probe: compute cargo SCU per ship with the extractor's own logic,
and list every loadout item that carries an inventory container."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sc_extract.p4k_compat import apply_p4k_compat  # noqa: E402
from sc_extract.dataforge_extract import (  # noqa: E402
    CodexExtractor, _default_loadout_of, _loadout_pairs,
)

P4K = sys.argv[1]
SHIPS = sys.argv[2:] or ["CNOU_Nomad", "DRAK_Cutlass_Black", "ANVL_Carrack",
                         "MISC_Freelancer", "AEGS_Gladius"]

apply_p4k_compat()
from scdatatools.p4k import P4KFile  # noqa: E402
from sc_extract.dataforge import DataForge  # noqa: E402

p4k = P4KFile(P4K)
dcb = next(n for n in p4k.namelist() if n.lower().endswith(".dcb"))
with p4k.open(p4k.getinfo(dcb)) as f:
    raw = f.read()
df = DataForge(raw)

ex = CodexExtractor.__new__(CodexExtractor)
ex.df = df
ex.on_log = lambda lvl, m: print("LOG", lvl, m, file=sys.stderr)

out = {}
for ship in SHIPS:
    rec = ex._entity_class(ship)
    if rec is None:
        continue
    comps = ex._entity_class_comps(ship)
    loadout = _default_loadout_of(comps)
    containers = []
    for port, cls in _loadout_pairs(loadout):
        ccomps = ex._entity_class_comps(cls)
        vol = ex._container_volume(ccomps)
        if vol is not None:
            containers.append({"port": port, "class": cls, "m3": vol,
                               "scu": round(vol / 1.25 ** 3, 2)})
    out[ship] = {"cargoScu": ex._cargo_scu(loadout),
                 "allContainers": containers,
                 "allContainerScu": round(sum(c["scu"] for c in containers), 2)}
    print(ship, json.dumps(out[ship], indent=1)[:2000], flush=True)

Path(sys.argv[0]).with_name("probe_cargo_scu_out.json").write_text(
    json.dumps(out, indent=1, default=str), encoding="utf-8")
