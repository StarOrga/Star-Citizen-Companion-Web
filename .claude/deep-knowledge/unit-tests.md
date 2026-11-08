# Unit tests — Vitest in a real browser

Since the Karma → Vitest move (concept `docs/concepts/20261108-2224-vitest-migration`), `npm test`
runs every `src/**/*.spec.ts` under Vitest in headless Chromium via Playwright
(`@angular/build:unit-test`, angular.json → `test`). Not jsdom: specs measure real layout, WebGL,
`requestAnimationFrame`, `ResizeObserver` and media queries.

## Moving parts

| Piece | Where | Why |
|---|---|---|
| Browser | `scripts/run-vitest.mjs` + `scripts/lib/vitest-chrome-bin.mjs` | Sets `CHROME_BIN` (Linux: system Chrome, Windows: Chrome, else Edge); the builder hands it to Playwright, so no Playwright browser download |
| Runner config | `vitest-base.config.mts` | `restoreMocks` (Jasmine undid spies after each spec, Vitest does not), shuffled test order like Jasmine |
| Setup | `src/app/testing/vitest-setup.ts` | zone's Vitest patch (`fakeAsync` needs it, the builder does not load it) and the new-tab guard |
| Window | `browserViewport: 1280x800`; `useViewport()` in `src/app/testing/viewport.ts` | A spec about another width pins it per describe |
| Guard | `scripts/vitest-scope.test.mjs` (`npm run test:gate`) | Browser mode, setup file, viewport default, and no Jasmine API left in a spec |

`npm test -- --include=app/codex/**/*.spec.ts` runs one area. A red run writes screenshots to `.vitest/`
(CI uploads them as `vitest-failure-screenshots`).

## Traps that differ from Karma / Jasmine

- **`fakeAsync` around Angular's own async code.** Angular packages are served by Vite unchanged, so
  their `async` functions use the native Promise, which the fakeAsync zone cannot flush. A setup that
  awaits `compileComponents()` never arrives inside `fakeAsync` ("The code should be running in the
  fakeAsync zone"). The components are AOT-compiled: drop `compileComponents()`.
- **`whenStable()` after a mocked promise** can stay pending (starmap comet spec). Wait for the result
  itself with `vi.waitFor(() => …)`.
- **`toContain` compares by reference** in Vitest; Jasmine compared deeply. Objects and arrays need
  `toContainEqual`.
- **`toBe` is `Object.is`**: `-0` is not `0`. **`toBeCloseTo(x, 0)`** excludes a difference of exactly 0.5.
- **Unhandled errors fail the run** even when every test passed (Karma only logged them). A spec whose
  links navigate needs routes for them, e.g. `provideRouter([{ path: '**', children: [] }])`.
- **`pending()` has no global**: use the test context, `it('…', ({ skip }) => { if (!gl) return skip('…'); })`.
- **Spies**: `vi.spyOn` calls through; a Jasmine-style stub is `.mockReturnValue(undefined as never)`
  or `.mockImplementation(…)`. `mock.lastCall` is typed `| undefined`: assert it with `!`.
- **i18n catalogues are imported, never fetched**: `import de from '…/public/i18n/de.json'`. A
  `fetch('/i18n/de.json')` from the dev server timed out a whole `beforeAll` (30 s) under full-suite load.
- Specs that open a real tab still fail by name (new-tab guard). Under Playwright the page stays
  visible, so the old "every frame-driven spec times out" cascade does not happen any more.

## Converting old Jasmine code

`node scripts/jasmine-to-vitest.mjs <file|dir>` runs the transformers of Angular's
`refactor-jasmine-vitest` schematic but rewrites only the changed expressions (the schematic reprints
whole files). It also applies the follow-ups above that have one right answer (`toContainEqual`,
`lastCall!`, `mockResolvedValue(undefined)`, typed empty spies). It reads the schematic's internals of
`@schematics/angular` 22.2.x; delete it once nothing Jasmine-shaped is left to convert.

Known flake: once in four full runs a file reported "No test suite found" and passed on rerun.
