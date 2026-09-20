# Wave 3 - QA report

HEAD verified: 217a8cb (docs(concept): wave 2.5 addendum - slot wiring,
i18n merge-hazard fix, updated inventory audit), branch
claude/codex-schiffsansicht-design-d0ab3a, worktree
C:/Users/Jerem/IdeaProjects/Star-Citizen-Companion-Web/.claude/worktrees/devops-learn-einsatz-optimize-6bd7e8.

Auth-gated routes (/codex/ship/:className?view=holo) were NOT exercised -
no test credentials in the environment, per the task brief. Public route
/hangar/shared/not-a-token was checked instead (section 6).

## Gates

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Typecheck | npm run typecheck | pass, no output/errors |
| 2 | Build | npm run build | pass, exit 0. dist/sc-companion/browser regenerated (confirmed by mtime AND clean process exit this run, no kill needed). One pre-existing WARNING: codex-detail.component.ts component styles 22.43 kB vs 18 kB budget (24 kB error budget not hit) - matches the documented pre-existing pattern, not a regression |
| 3 | Unit tests (web) | npm test (Karma/ChromeHeadless) | 2827/2827 passed, 0 failed |
| 4a | data-uploader Python | PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest python (after npm ci) | 362 passed - see note below |
| 4b | data-uploader vitest | npx vitest run | 325/325 passed (29 files), including upload-resume.spec.ts - no flake hit, no rerun needed |
| 4c | data-uploader tsc | npx tsc --noEmit -p tsconfig.json | pass, no output/errors |
| 5 | Mobile gate | npm run gate:mobile:quick | GREEN - 4 page audits (/about, /login x 2 devices), 0 blocking findings, 0 warnings. 9 routes UNCHECKED (/news /codex /codex/index /codex/keybinds /codex/ship/CNOU_Nomad /starscape /hangar /release-notes /admin/feedback) - need --auth, no creds available, as expected |
| 6 | Browser: /hangar/shared/not-a-token | see below | see below |
| 7 | Nothing-lost audit | wave0 section A vs wave2-stage.md/wave2-strip-hangar.md | see table below |
| 8 | i18n | duplicate-key scan plus key-existence cross-check | pass, see below |
| 9 | CLAUDE.md rules on git diff 7a29bfe..HEAD -- src/app | grep-based | 1 should-fix finding, see Findings |

### Note on gate 4a

The task briefs literal invocation PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 npx
pytest python silently resolves to an unrelated npm package named pytest
(a Node HTTP test-fixture server, not Pythons pytest) which hangs
listening on port 8888 and never exits - this is what actually stalled
the first attempt (backgrounded, 0 bytes output for 6+ minutes, two
python.exe child processes alive but idle). Killed and reran as
python -m pytest python (matching python/pyproject.toml own documented
invocation) - this is the correct command and is what produced the 362
passed result above. Flagging this because a future QA run copying the
literal brief text verbatim will hit the same false hang.

### Gate 6 - Browser verification of /hangar/shared/not-a-token

No Playwright, Chrome-extension, or Claude-Preview browser tool was
available in this agent toolset this session (only Bash/Read/Glob/Grep) -
could not capture a live snapshot, console log, or network log. Fell back
to:

- curl http://127.0.0.1:4200/hangar/shared/not-a-token gave HTTP 200, the
  Angular app shell (boot splash) is served - confirms the route resolves
  server-side/at the dev-server level.
- Static code trace of the client-side behaviour instead of a live capture:
  HangarService.peekSharedLoadout() (src/app/hangar/hangar.service.ts:826-832)
  calls .rpc(peek_shared_loadout, p_token: token); on error or missing data
  it returns null. HangarSharedLoadoutComponent
  (src/app/hangar/hangar-shared-loadout.component.ts:118-125) sets
  state.set(unavailable) on a falsy token or a null peek result, rendering
  hangar.shared.unavailable.title and .body - both keys confirmed present in
  the de and en translation files (gate 8). This matches the briefs
  expectation (404 on rpc/peek_shared_loadout is EXPECTED, migrations are
  not pushed yet) by code inspection, but is NOT a substitute for an actual
  browser console/network capture - flagged as a gap, not asserted as
  verified.

## Section 7 - Nothing-lost audit (wave0-research.md section A, 59 rows)

Wave 2.5 (wave2-stage.md, Updated inventory audit - all 59 rows) already
states only THREE rows remain a loss, all explicitly user-accepted.
Spot-verified a representative cross-section of claimed locations directly
in the current HEAD code (grep, file:line) rather than trusting the docs
own claims verbatim; every spot check matched. Full table below, verdict
column marks OK where independently grepped this session, OK (doc) where
relying on the wave2-stage.md consolidated table without an independent
re-grep this session (budget), MISSING/DEGRADED where the code disagreed
(none found).

| # | Row | Claimed location | Verified (file:line) | Verdict |
|---|---|---|---|---|
| 1-4 | Crumb row (back, data pill, provenance, states) | parent, unchanged | codex-detail.component.ts:289-308 unchanged by diff (not touched in git diff 7a29bfe..HEAD) | OK |
| 5-9 | Hero art/3D/2D-3D toggle/eyebrow/h1 | Table silhouette plus holo-eyebrow plus 3D text-toggle | codex-holo-stage.component.ts:132-133 (.holo-eyebrow-row/.holo-eyebrow), :239-240 (view3d/viewSchema toggle buttons), :262 (.silhouette-frame) | OK |
| 10 | Career/crew/cargo/mass chips | heroChips() in Einsatz header (Wave 2.5 item 4) | codex-detail.component.ts:421-436 (heroChips() template use, made public), stage consumes via heroChips input | OK |
| 11 | Module census chips | .holo-chips, stageCounts() | codex-holo-stage.component.ts:157-159 | OK |
| 12 | Pin/compare toggle | accepted loss (concept decision 3) | grep for togglePin/isPinned in holo/: none | OK (accepted loss) |
| 13 | Factory loadout | Change journal discard-all button | codex-holo-stage.component.ts:407 (journal section present) | OK (doc) |
| 14 | Copy share link | Teilen toggle to copyShareLink output | codex-holo-stage.component.ts:251,676 | OK |
| 15 | Switch ship | accepted loss (concept decision 3) | grep for actionSwitchShip in holo/: none | OK (accepted loss) |
| 16-17 | Edition/skin pickers | Details drawer, projected verbatim | codex-detail.component.ts:472-501 (editionOptions/skinOptions, projected into stage ng-content) | OK |
| 18 | classNameSlug code | Details drawer (projected) | codex-holo-stage.component.ts:139,248 (detail().classNameSlug threaded to children) | OK |
| 19 | Add to hangar | Details drawer plus hangar-tab slot | codex-holo-stage.component.ts:180,625 (inHangar input) plus codex-holo-hangar.component.ts mounted | OK |
| 20 | RSI link | Details drawer (projected) | codex-detail.component.ts:630-632 | OK (doc) |
| 21-23 | Ship-link form plus admin promote | Details drawer, admin accent unchanged | codex-detail.component.ts:202,643 | OK (doc) |
| 24 | Rank card (full) | Left panel, reused component | codex-holo-stage.component.ts:21,220 (CodexRankCardComponent imported plus mounted) | OK |
| 25-26 | KPI band, mission bar | Einsatz header | referenced in wave2-stage.md :107-115; not independently re-grepped this session | OK (doc) |
| 27 | Draft save bar | Einsatz header (Wave 2.5 item 4) | sc-codex-loadout-save-bar claimed around codex-holo-stage.component.ts:160-172, not independently re-grepped | OK (doc) |
| 28 | Draft persistence (URL/localStorage) | parent, unchanged | outside git diff 7a29bfe..HEAD for this logic | OK |
| 29-39 | Loadout column plus hardpoint-layout rows | Right panel Ports | codex-holo-stage.component.ts:352 (sc-codex-hardpoint-layout mounted) | OK |
| 40 | Analysis column heading | Perspectives heading | codex-holo-stage.component.ts:77 (comment: one Alle Werte perspective tile) | OK |
| 41-43 | Offensive/defensive/ship panels | Perspective tiles Alle Werte expand | grep confirms perspective tile machinery present (:77, :924); full panel mount not independently re-grepped | OK (doc) |
| 44 | Full 3D section below columns | not built per wave2-stage.md Q2, then built in Wave 2.5 item 2 (3D/Schema in place) | codex-holo-stage.component.ts:239-240 toggle buttons confirmed; in-place mount, not a separate section, matches Wave 2.5 stated resolution | OK (doc, superseded) |
| 45 | Fixed systems | Details drawer (projected) | tailModuleSections input present (codex-holo-stage.component.ts:606,807) | OK |
| 46 | Description | Details drawer (projected) | not independently re-grepped | OK (doc) |
| 47-48 | Ammo/stat groups | out of scope (ship kind never reaches these) | logically correct, kind()==='ship' gates the whole holo branch | OK |
| 49 | Structural hardpoints | Details drawer, full markup per Wave 2.5 item 6 | codex-detail.component.ts:1395-1456 claimed by doc; not independently re-grepped | OK (doc) |
| 50 | Crafting | Details drawer (projected) | codex-detail.component.ts:1065,1095 (recipe()/usedInBlueprints()) | OK |
| 51 | Spec/raw | Details drawer (projected, verbatim) | codex-detail.component.ts:1118-1129 (specSections()) | OK |
| 52 | Energy dock (minus position radio) | parent, unconditional; position radio dropped (accepted, wave2-strip-hangar.md) | codex-detail.component.ts:1500 (sc-codex-energy-dock mount, outside the holo/classic swap) | OK (accepted partial loss) |
| 53 | Compare tray | parent, unconditional | codex-detail.component.ts:1511 | OK |
| 54-56 | Component modal / swap picker / weapon detail | parent, unconditional | codex-detail.component.ts:1515-1517 | OK |
| 57 | Hover sync (activePorts) | shared signal | codex-holo-stage.component.ts:100,265 | OK |
| 58 | Keyboard (Esc/Enter/Arrow) | unchanged, parent-owned modals | outside the swapped region, not modified by this diff | OK |
| 59 | i18n discipline | codex.* keys under both i18n translation files, i18n-keys.spec.ts guards | src/app/codex/i18n-keys.spec.ts exists; ran independently (gate 8), 107 codex.holo.*/hangar.shared.* keys all resolve in BOTH translation files, 0 missing | OK |

Verdict for section 7: no undocumented losses found. The only three losses
(row 12, row 15, row 52 dock-position radio) are the same three the Wave 2.5
addendum already names as user-accepted (concept decision 3 / concept
it.10) - consistent with the task own only-accepted-losses list.

## Section 8 - i18n

- Both de and en translation files: JSON.parse clean.
- Duplicate-key scan (hand-written bracket-depth walker, not JSON.parse, per
  the Wave 2.5 addendum own warning that JSON.parse silently picks a winner
  on a duplicate key): zero duplicate keys at any nesting level in either
  file - confirms the Wave 2.5 addendum claimed fix actually landed.
- Extracted every codex.holo.* key literal from src/app/codex/holo/*.ts (88
  keys) plus the two template-literal-constructed key families
  (codex.holo.stage.perspective.ID and codex.holo.strip.PERSPECTIVE,
  expanded against the 4 known Perspective values from
  codex-build-compare.ts:19) plus every hangar.shared.* key from
  hangar-shared-loadout.component.ts (12 keys) - 107 total, all 107 resolve
  in both translation files, 0 missing.

## Section 9 - CLAUDE.md rules on git diff 7a29bfe..HEAD -- src/app

- Navigation-as-anchor rule: grepped the diff for plus-lines adding a click
  handler on a div or span - zero matches. No new non-anchor navigation
  introduced.
- No hardcoded DE/EN UI strings in templates: grepped the diff for the
  words Einsatz, Alle Werte, Detail, Rueckgaengig, Zusammenfassung - every
  hit is inside a comment, a CSS class name, or a translate binding. Zero
  hardcoded UI strings found.
- Admin-accent-color scope check: 1 should-fix finding, see Findings below.

## Findings

### Should-fix

- Admin-accent color used for a non-admin-gated patch-diff indicator.
  src/app/codex/holo/codex-holo-stage.component.ts:546 (the pin.patched
  outline rule) and :552 (the inspector-patch-delta text color rule) both
  reference the admin accent color variable. The patch-compare feature that
  produces these (sc-codex-holo-patch,
  src/app/codex/holo/codex-holo-patch.component.ts) is reachable by any
  signed-in-or-not viewer - only the schema-detail block inside its popover
  is gated behind roles.isCollaborator() (codex-holo-patch.component.ts:133);
  the trigger, the build picker, and the resulting port-pin/delta rendering
  (lines 81-131) are not gated at all. Per root CLAUDE.md own rule that the
  admin accent marks elevated-access surfaces and anything a plain viewer
  may use stays on the normal accent, these two rules should use the normal
  accent (or a distinct non-red color), not the admin one, since a plain
  viewer reaches the patch-compare pin/delta display without any elevated
  role. The genuinely admin-gated schema block inside the same component
  already correctly uses the admin accent - only the two stage-level rules
  above are miscolored.

### Notes

- Gate 6 (browser verification) could not be performed with a live
  browser/console/network capture - no Playwright, Chrome-extension, or
  Claude-Preview tool was present in this QA agent toolset this session.
  Substituted a curl fetch (200, app shell served) plus a static code trace
  confirming the expected RPC-failure to unavailable-state path exists and
  its i18n keys resolve. This is weaker evidence than an actual
  console/network read and should be re-run with a browser tool before this
  is treated as fully verified.
- The task brief literal pytest invocation resolves to an unrelated npm
  package and hangs on port 8888 - see the gate-4a note above. Future QA
  runs should use the python -m pytest form directly.
- The build prebuild step (a release-notes generator script) rewrites a
  generated public data file as a side effect of running the build gate;
  reverted via a git checkout after the build so this QA pass leaves no
  unintended source changes.

## Verdict

WAVE 3 PASS WITH FINDINGS - one should-fix (admin-accent color scope on the
patch-diff pin/delta indicators), one process note (browser gate
substituted with static verification, no browser tool available), no
blockers, no missing inventory rows beyond the three already user-accepted
losses.
