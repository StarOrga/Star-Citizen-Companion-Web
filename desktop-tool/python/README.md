# SC Companion · Python Sidecar

This is the Python-side extractor for the Desktop Tool. The Electron main
process spawns this as a subprocess and reads its stdout (JSON-lines) for
progress events.

## Architecture (Phase 2 § A1 + § B1)

- **Library**: [scdatatools](https://github.com/StarCitizenTools/scdatatools) — pure-Python P4K + DataCore parser
- **Runtime**: Embedded Python (python-build-standalone, ~25 MB), no system Python required
- **IPC**: stdin/stdout JSON-lines (`{"type": "phase", "phase": "extract", "pct": 42}` etc.)
- **Streaming**: pro Entity-Class iterieren, JSON-Chunk auf Disk schreiben, dann nächste — kein 80 GB im RAM

## Setup (Dev)

```bash
# from desktop-tool/python/
pip install -r requirements.txt
python -m sc_extract.extract --help
```

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
