# Test fixtures

## Phase 1

`discovery.spec.ts` and `performance.spec.ts` generate their fixtures on the fly
into `os.tmpdir()` — no on-disk fixtures needed.

## Phase 2 (open question)

For end-to-end extractor tests, we'll need a **synthetic P4K** — a small ZIP
(~50 MB) with a representative mix of CryEngine XML files, icons, and
component manifests, but no copyrighted assets. Tracked as concept Open
Question #5.
