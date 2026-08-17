---
name: devops-test-plan
description: Test-plan extension for SC Companion — profile override + live-probe rules (stable consumer-contract path).
---

# Test-plan extension — SC Companion

There is no `/devops-test-plan` skill anymore — test guidance lives in the
plugin's `deep-knowledge/test-plan.md`, and THIS directory
(`.claude/skills/devops-test-plan/`) is the **stable consumer-contract path**
it reads project extensions from (§ Custom Profiles). The
`post.flow.completion` V&V hook also reads `profile.json` from here on every
turn. **Keep the directory name** — renaming it detaches the profile override
and the hook carve-outs. Plugin defaults still apply; only the rules below
override or add.

## Project rules

1. **"Ist alles live?" → multi-surface probe in EINEM parallelen Bash-Call.**
   When the user asks about live deploy status ("ist alles live", "teste die
   original seite", "verify deploy"), probe all 5 surfaces in parallel:
   Vercel, GH Release page, GH Release asset, Edge Functions, Postgres.
   Never single-surface and declare "alles live". See
   [reference.md § Live-Probe-Snippet](./reference.md#live-probe-snippet) for the
   ready-to-paste command. Then cross-check results against
   `.claude/deep-knowledge/deployment-status.md`.

2. **GitHub auth wall: `curl` against private-repo URLs lies with 404.**
   github.com returns 404 (not 403) for private repos probed without an auth
   header. Always use `gh` CLI for any github.com URL — it injects the token.
   If a probe must use raw curl, explicitly note in the report: "404 here
   means private+unauthenticated, not missing".

3. **Responsive verification = `npm run gate:mobile`, not screenshot vibes.**
   The five-viewport screenshot loop of the plugin's `web-angular` profile is
   replaced by [`scripts/mobile-gate.mjs`](../../../scripts/mobile-gate.mjs)
   (see `profile.json` next to this file). It drives real Chromium via CDP with
   iOS + Android phone/tablet device emulation and asserts machine-checkable
   rules (no horizontal overflow, tap targets ≥ 44 px, text ≥ 12 px, no clipped
   or overlapping content, no fixed/sticky element covering a control, zoomable
   viewport meta, no console errors) across the public routes.

   - inner loop: `npm run gate:mobile:quick` (2 devices × 4 routes)
   - before shipping: `npm run gate:mobile` — mandatory, see
     `.claude/skills/ship/SKILL.md` rule 1
   - after editing the gate itself: `npm run gate:mobile:selftest` proves every
     check still detects its fixture violation
   - the desktop viewport (1280×800) stays a normal `$BROWSER_TOOL` screenshot;
     the gate deliberately only owns phone + tablet
   - full reference: [`docs/mobile-gate.md`](../../../docs/mobile-gate.md)

4. **Auto-update download URL is the public mirror — probe it unauth.**
   Since issue #7's resolution, binaries are mirrored to public repo
   `StarOrga/Star-Citizen-Companion-Binaries`. After every `data-uploader-v*` release,
   `curl -sIL <mirror_asset_url>` UNAUTHENTICATED — expect 302→200 with
   Content-Length ~126 MB. 404 means the PAT `BINARIES_RELEASE_TOKEN` is
   missing/expired OR the mirror release wasn't created. See
   [reference.md § Auto-update download probe](./reference.md#auto-update-download-probe).
