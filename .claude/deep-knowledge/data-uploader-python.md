# Data Uploader Python Sidecar

The Data Uploader ships an embedded Python interpreter
(`data-uploader/resources/python/python.exe`) downloaded by
`scripts/fetch-embedded-python.js` from
[astral-sh/python-build-standalone](https://github.com/astral-sh/python-build-standalone).
The sidecar source is in `data-uploader/python/sc_extract/`.

## Python version is constrained by scdatatools, not by us

**`scdatatools 1.0.4` (the version `requirements.txt` pins) declares
`numpy~=1.21.5`.** This metadata pin did NOT change from 1.0.0 — verified
against the installed 1.0.4 distribution. PEP 440 compatible-release specifier
`~=1.21.5` resolves to `>=1.21.5, <1.22`. Every numpy 1.21.x wheel declares
`Requires-Python: >=3.7, <3.11`. So a clean `pip install -r requirements.txt`
requires **Python 3.10.x** — not 3.11, not 3.12, not 3.13.

**Runtime ≠ install — do not be misled.** scdatatools 1.0.4 *imports and runs*
under Python 3.12 IF numpy 2.x was force-installed over the metadata conflict
(which is exactly how a dev box that upgraded numpy later still works — e.g.
`import scdatatools` succeeds under system 3.12 + numpy 2.2.0). That is NOT a
clean install: a vanilla `pip install -r requirements.txt` on 3.12 fails
(numpy 1.21.x has no cp31x wheel). **Keep the embedded build on 3.10.** "It
imports on my 3.12" is not grounds to bump `PYTHON_VERSION`.

History: tried 3.13 first (build failed, no numpy 1.21.x wheel for 3.13),
then 3.11 (also failed — numpy's `<3.11` is strict, not `<=3.11`), finally
3.10.x worked. The python-build-standalone `20241016` release has a
3.10.x Windows-msvc-install_only build that pip-installs the requirements
cleanly.

### Bumping rules

- **Never** bump embedded Python without checking scdatatools's transitive
  pins. The chain that matters is `scdatatools → numpy → Requires-Python`.
- **Don't** trust the "latest stable Python" heuristic — pip's error
  message ("Could not find a version that satisfies the requirement
  numpy~=1.21.5") is the signal that you crossed a transitive boundary.
- To lift the embedded Python in the future, EITHER bump scdatatools to a
  2.x version that allows modern numpy, OR keep 1.0.4 and stay on 3.10.

## Local-dev fallback

The bridge (`src/main/python-bridge.ts`) looks for the interpreter in
this order: `$SC_EXTRACT_PYTHON` env override → `process.resourcesPath/python/python.exe`
(packaged) → system `python` (dev). For local dev without running
`npm run python:fetch`, the system Python must also be 3.10 with the
`requirements.txt` deps (scdatatools 1.0.4) installed, OR run with
`SC_EXTRACT_PYTHON=...` pointing to a working venv.

> ⚠️ A system `python` that is 3.12 (or anything ≠ 3.10) will still *spawn* and,
> if scdatatools is force-installed, run — but a bare `python` on a default
> Windows box can also resolve to the 0-byte Microsoft Store alias stub, and a
> 3.12 without scdatatools silently drops into **stub mode** (fabricated data,
> exit 0). Prefer `SC_EXTRACT_PYTHON` pointing at a real 3.10 venv for dev.

## Stdout encoding — the cp1252 trap (fixed)

The bridge spawns every sidecar with `-E`, which makes Python ignore
`PYTHONUTF8`/`PYTHONIOENCODING`. On Windows the child's *piped* stdout therefore
defaults to the legacy locale code page (cp1252 on a German box), while the
Node side reads it as UTF-8. The events emit `ensure_ascii=False` JSON, so any
char outside cp1252 (`→`, `…`, smart quotes, CJK/Cyrillic loc strings) used to
raise `UnicodeEncodeError` mid-stream (run dies, exit 1) or mangle to `�`.

Fix (do not regress): `events.py` calls `sys.stdout.reconfigure(encoding="utf-8",
errors="replace")` at import for ALL entrypoints, the bridges pass `-X utf8`
(a CLI flag `-E` does NOT strip), and `emit_event` has a pure-ASCII
`buffer.write` fallback. Keep all three — they are belt-and-suspenders.

## CI

`.github/workflows/data-uploader-build.yml` has two jobs:

- `python-sidecar-test` (ubuntu, Python 3.10) — runs pytest against the
  synthetic fixture, no scdatatools install (pip only installs pytest).
- `build-windows` (windows, triggered by `data-uploader-v*` tag) — runs
  `fetch-embedded-python.js` against PBS Windows 3.10.x + full
  requirements.txt including scdatatools.

Both must succeed before the binary publishes.

The PBS download retries transient failures (network errors, 5xx, a stream
that breaks mid-body) 4× with 2s/4s/8s backoff and logs every attempt as
`[fetch-python] download attempt N/4`; a 404 (wrong `PBS_RELEASE`/`ASSET`
pin) fails at once. Added after the `data-uploader-v0.25.2` build died 300 ms
into the first `fetch()` with a bare `fetch failed` on a reachable URL
(2026-09-04). If a build still fails with `[fetch-python] FAILED: download
failed after 4 attempts`, the runner's network was down for ≥14 s — rerun the
job. The retry helper is unit-tested in
`data-uploader/test/fetch-embedded-python.spec.ts`.
