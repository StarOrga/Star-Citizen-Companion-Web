# SC Companion · Python Sidecar

This is the Python-side extractor for the Desktop Tool. The Electron main
process spawns this as a subprocess and reads its stdout (JSON-lines) for
progress events.

## Architecture

- **P4K reader**: [scdatatools](https://gitlab.com/scmodding/frameworks/scdatatools) `1.0.4`,
  used **only** to open the archive (zip central directory + transparent AES +
  zstd). Opening the live SC 4.x `Data.p4k` requires the runtime patch in
  `sc_extract/p4k_compat.py` (see `.claude/deep-knowledge/p4k-format.md`).
- **DataCore reader**: **our own pure-Python `sc_extract/dataforge.py`**. The
  live `Data/Game2.dcb` is DataForge **v8**, which scdatatools 1.0.4 cannot
  parse (the v8 record struct grew 32 → 36 bytes). Our reader handles v6 + v8,
  resolves the full record object graph (StrongPointers, inline Classes,
  References, WeakPointers) and emits JSON-able dicts via `record_to_dict`.
- **Extractor**: `sc_extract/dataforge_extract.py` writes (a) an **exhaustive
  generic dump** of every record of every type — the "all values of all game
  elements" guarantee — plus (b) typed projections (ships, weapons, components,
  ammunition, manufacturers) matching `docs/concepts/codex-extraction-output.md`.
- **Localization**: `sc_extract/localization.py` parses
  `Data/Localization/{english,german_(germany)}/global.ini` and resolves
  `@`-keys to `{de, en, key}`.
- **Runtime**: Embedded Python (python-build-standalone, ~25 MB), no system Python required.
- **IPC**: stdin/stdout JSON-lines (`{"type": "phase", "phase": "extract", "pct": 42}` etc.) — unchanged.
- **Streaming**: the dcb (~305 MB decompressed) is parsed in-memory once
  (~7 s); records are streamed to per-type/per-entity JSON files on disk, not
  held in RAM.

> **DataForge v8 note:** the binary grammar (header, section order, v6-vs-v8
> record size, the 0x0001–0x0310 data-type codes, two string tables, instance
> offset math) was reverse-engineered from the MIT/Apache-licensed StarBreaker
> Rust reader (`diogotr7/StarBreaker`). `sc_extract/dataforge.py` is original
> Python modelled on that documented layout — no game assets are embedded.

## Setup (Dev)

```bash
# from desktop-tool/python/
pip install -r requirements.txt
python -m sc_extract.extract --help

# real extraction against the live game files:
python -m sc_extract.extract \
  --p4k 'C:\Program Files\Roberts Space Industries\StarCitizen\LIVE\Data.p4k' \
  --out 'C:\Users\<you>\AppData\Local\sc-companion\extracts\LIVE' \
  --channel LIVE --patch 4.x --build <build>
```

### Schema discovery (local dev)

`scripts/discover_schema.py` opens the live P4K, parses the DataCore and writes
`sc_extract/datacore_schema.json` (record-type histogram, component-param
histogram, `AttachDef.Type` vocabulary, entity-path buckets). Run it after each
game patch to spot schema drift before trusting the typed projections.

## Streaming protocol (stdin/stdout)

Electron writes one JSON line to stdin to start an extract:

```json
{"action": "extract", "p4k_path": "C:\\...\\LIVE\\Data.p4k", "out_dir": "C:\\Users\\...\\AppData\\Local\\sc-companion\\extracts\\LIVE-4.0.0", "scope": {"hd_icons": true, "render_pngs": true, "component_tree": true}, "channel": "LIVE", "patch_version": "4.0.0", "build_number": "9123456"}
```

Python emits one JSON line per progress event:

```jsonl
{"type":"phase","phase":"discover","pct":0}
{"type":"log","level":"info","message":"opened p4k: 87.3 GB"}
{"type":"phase","phase":"extract","pct":8}
{"type":"file","fileName":"Data/Game.dcb","pct":12,"bytesProcessed":18000000,"bytesTotal":280000000}
{"type":"log","level":"info","message":"extracted ship: AEGS_Gladius"}
{"type":"count","counter":{"key":"ships","value":42}}
{"type":"phase","phase":"validate","pct":85}
{"type":"count","counter":{"key":"ships","value":182}}
{"type":"log","level":"warn","message":"Pure-Counter validator: ships=182 below expected ~180 — yellow"}
{"type":"phase","phase":"bundle","pct":95}
{"type":"done","pct":100,"result":{"channel":"LIVE","patch_version":"4.0.0","build_number":"9123456","schema_version":1,"quality_score":92,"entity_counts":{"ships":182,"weapons":247,"items":1493,"components":612,"strings":52341},"manifest_path":"...","output_dir":"..."}}
```

## Embedded Python Setup

For packaged releases, `desktop-tool/scripts/fetch-embedded-python.js` downloads
the [python-build-standalone](https://github.com/indygreg/python-build-standalone)
release for Windows-x64 + installs the pinned requirements. The result lands
in `desktop-tool/python/_runtime/` which electron-builder bundles into the
release.

For dev (`npm run dev`), the sidecar uses the system Python as fallback.

## Plausibility-Validator (Pure Counter + minimal Heuristik)

Per concept Iter 3 § II + Iter 2 § D2:
- Counter-Schwellen pro Entity-Typ (configured in `sc_extract/thresholds.py`)
- Plus minimal per-Entity Heuristik nur für „ein paar wenige Sub-Daten" (User-Comment Iter 3)
- Score = `min(green_threshold / count × 100, 100)` aggregiert über Counter
- Warnings sammeln, kein Hard-Error bei fehlenden Feldern (RSI-Schema-Drift-tolerant)
