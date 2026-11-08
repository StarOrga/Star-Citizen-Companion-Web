# Implement brief — Karma → Vitest (round 1, action `implement`)

Decisions: [`../../20261108-2224-vitest-migration-decisions.json`](../../20261108-2224-vitest-migration-decisions.json)
Round fragment: [`../rounds/01.html`](../rounds/01.html)

## Verbatim user input

Round 1 carried no comments, notes, pins or attachments (`comments.general.text` = "",
every `*-note` = "", `userPins` = []). The answers below are the payload values.

| Decision | Answer | Recommended | Deviates | Untouched |
|---|---|---|---|---|
| d-cut — Zuschnitt der übrigen Specs | `allin` — „Alles in einem PR, Reste eingeschlossen“ | bulk | yes | no |
| d-fakeasync — Zone-fakeAsync oder vi-Timer | `zone` — „Zone-fakeAsync mit dem Patch behalten“ | zone | no | no |
| d-matchers — Nacharbeiten im Treiber | `contain`, `lastcall`, `resolved`, `stub` | all four | no | no |
| d-guards — Leitplanken unter Vitest | `newtab`, `frames`, `shuffle` | all three | no | **yes** (5 s, not looked at) |
| d-viewport — Viewport der Specs | `desktop` — „Auf 1280 × 800 umstellen“ | parity | yes | no |
| d-unhandled — Unbehandelte Fehler | `fix` — „Specs mit Test-Routen reparieren“ | fix | no | no |
| d-ci — Browser in CI | `system` — „System-Chrome des Runners“ | system | no | no |

`d-guards` is untouched: it is built with its preselection (nothing changes against the pilot),
and the final report says so instead of claiming consent.

## Checklist

1. [ ] Driver learns `toContain(<object/array literal or asymmetric matcher>)` → `toContainEqual` (d-matchers.contain)
2. [ ] Driver adds `!` to `mock.lastCall` (d-matchers.lastcall)
3. [ ] Driver turns `mockResolvedValue()` into `mockResolvedValue(undefined)` (d-matchers.resolved)
4. [ ] Driver turns the bare-spy `mockReturnValue(undefined)` into `mockReturnValue(undefined as never)` (d-matchers.stub)
5. [ ] Every spec under `src/` and the shared helpers run under Vitest, in this one PR, the 24 hand-work files included (d-cut.allin); zone `fakeAsync` stays (d-fakeasync.zone)
6. [ ] Viewport 1280 × 800; every spec that relied on the 749 px phone branch is adapted (d-viewport.desktop)
7. [ ] The 4 specs with NG04002 get test routes; no unhandled error is ignored (d-unhandled.fix)
8. [ ] Karma is gone: deps, `karma.conf.cjs`, `run-karma`, Jasmine types, `new-tab-guard.spec.ts`, Dependabot's Jasmine ignore; `npm test` = Vitest; CI runs one unit job on the runner's system Chrome (d-ci.system); new-tab guard, `frames.ts`, shuffle kept (d-guards)
