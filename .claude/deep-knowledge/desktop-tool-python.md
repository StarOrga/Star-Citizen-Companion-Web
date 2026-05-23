# Desktop-Tool Python Sidecar

The desktop tool ships an embedded Python interpreter
(`desktop-tool/resources/python/python.exe`) downloaded by
`scripts/fetch-embedded-python.js` from
[astral-sh/python-build-standalone](https://github.com/astral-sh/python-build-standalone).
The sidecar source is in `desktop-tool/python/sc_extract/`.

## Python version is constrained by scdatatools, not by us

**`scdatatools 1.0.0` declares `numpy~=1.21.5`.** PEP 440 compatible-release
specifier `~=1.21.5` resolves to `>=1.21.5, <1.22`. Every numpy 1.21.x wheel
declares `Requires-Python: >=3.7, <3.11`. So the embedded Python MUST be
**Python 3.10.x** — not 3.11, not 3.12, not 3.13.

History: I tried 3.13 first (build failed, no numpy 1.21.x wheel for 3.13),
then 3.11 (also failed — numpy's `<3.11` is strict, not `<=3.11`), finally
3.10.x worked. The python-build-standalone `20241016` release has a
3.10.x Windows-msvc-install_only build that pip-installs scdatatools
cleanly.

### Bumping rules

- **Never** bump embedded Python without checking scdatatools's transitive
  pins. The chain that matters is `scdatatools → numpy → Requires-Python`.
- **Don't** trust the "latest stable Python" heuristic — pip's error
  message ("Could not find a version that satisfies the requirement
  numpy~=1.21.5") is the signal that you crossed a transitive boundary.
- To lift the embedded Python in the future, EITHER bump scdatatools to a
  2.x version that allows modern numpy, OR keep 1.0.0 and stay on 3.10.

## Local-dev fallback

The bridge (`src/main/python-bridge.ts`) looks for the interpreter in
this order: `$SC_EXTRACT_PYTHON` env override → `process.resourcesPath/python/python.exe`
(packaged) → system `python` (dev). For local dev without running
`npm run python:fetch`, the system Python must also be 3.10 with
`scdatatools 1.0.0` installed, OR run with `SC_EXTRACT_PYTHON=...` pointing
to a working venv.

## CI

`.github/workflows/desktop-tool-build.yml` has two jobs:

- `python-sidecar-test` (ubuntu, Python 3.10) — runs pytest against the
  synthetic fixture, no scdatatools install (pip only installs pytest).
- `build-windows` (windows, triggered by `desktop-v*` tag) — runs
  `fetch-embedded-python.js` against PBS Windows 3.10.x + full
  requirements.txt including scdatatools.

Both must succeed before the binary publishes.
