# Codex test lens (2026-10-02)

## 1. Run result
ng test with --include=src/app/codex/**/*.spec.ts and --code-coverage (--include works)
- 1635 of 1635 SUCCESS, 0 failed, 0 skipped. About 35 s wall.
- Noise only: expected logWarn lines from error-path specs, Lit dev-mode warning, GoTrue lock deprecation, 2 esbuild css-syntax warnings from the Angular compiler (Expected identifier but found whitespace; Unexpected var-open-paren) - some style block has odd CSS, worth locating.
- Coverage HTML: coverage/sc-companion/app/codex/ (build output).

## 2. Coverage gap map
### Files without any spec
detail/codex-port-list.component.ts, detail/codex-recipe-card.component.ts, detail/codex-ship-actions.component.ts, detail/codex-ship-link-form.component.ts, holo-ready-badge.component.ts, build-refresh.util.ts, codex-board-suit.ts, hardpoint-port-ref.ts (codex.types.ts is types only). The detail/ components are partly covered indirectly via codex-detail.component.spec and ship-link-form.store.spec.

### Lowest coverage (statements % / branches %)
- codex.service.ts 45 / 35
- codex-bridge.component.ts 66 / 48
- detail/ship-link-form.store.ts 69 / 70
- holo/codex-holo-share.component.ts 69 / 38
- codex-component-modal.component.ts 69 / 43
- codex-weapon-detail.component.ts 72 / 50
- stage/hangar-picker.component.ts 73 / 64
- holo/codex-holo-stage 74 / 58, holo/codex-holo-strip 75 / 64
- codex-detail.component.ts 76 / 56
- codex-landing.component.ts 79 / 63
- codex-swap-picker.component.ts 79 / 58
- codex-rank-card.component.ts 80 / 42
- codex-compare-tray.component.ts 80 / 40
- upcoming-grid.component.ts 82 / 43

### (a) Search surfaces
- codex-list (codex-list.component.spec.ts): has URL mirror of q via onSearchInput (L705), cross-category hint (L555), category/facet restore from URL (L537). Untested: ?q= seeding the box on load (code L1270), clear button, empty-result state for a term, normalization (case/umlaut/trim), q on kind switch.
- fps-list (fps-list.component.spec.ts): has restore q+facets from URL (L514), star wildcard (L570), URL write q (L666). Untested: clear removes q from URL, empty state for a term, case/diacritic/trim.
- keybinds (keybinds.component.spec.ts): has onSearch filter + no-match (L208), raw-key search (L256), 2+ char auto-expand (L649). Untested: a no-results-for-term message (only groups().length 0 is asserted; the empty-state spec is for nothing published), EN-mode search, whitespace/case, 1-char behaviour, URL q sync (decide intent).
- swap picker (codex-swap-picker.component.spec.ts): one happy path omnisky (L257) via the real input. Untested: clear, empty-table message, search + scope + type chip combo, reset/persist on reopen.
- set gear: no search control exists (see b). hangar picker: no search exists (chain only) - confirm intent.
- upcoming grid (upcoming-grid.component.spec.ts): 5 specs (anchors, favourite, load, error, empty feed). The component HAS search (query, onQuery, clearQuery) with ZERO tests: filter, clear, no-match, ?q= seed from the poly-search link.
- landing terminal (codex-landing.component.spec.ts): one hit-render test using searchTerm.set (L443). Untested: typing through the DOM input (onSearchInput), results.empty state, clear, ?q= seed (code L788).
- poly-search (codex-poly-search.spec.ts): strong pure-function coverage (score, rank, links, upcoming). No normalization cases (umlaut, underscore className, empty/whitespace, unicode).
- Cross-cutting: no shared search contract spec; swap-table normalize(), poly-search, fps-list and keybinds each normalize on their own and nothing asserts they agree.

### (b) FPS set selection flow
Covered only in isolated pieces:
- set-stage: tile links carry cat/equipInto/equipSlot (L92), plain-click hop (L179)
- fps-list: equip refused (L120), landed -> equipped marker (L136), saving state (L207), clear + stale-from-other-tab (L224), slot fitting (L392-429), past-patch disables equip (L246)
- set-gear: clear, undo, busy, stale clear (L185-294)

Missing:
1. No integration spec across the hop: set tile -> fps-list equip band -> equip -> back to set shows the piece (persisted through the service, not mocked on each side).
2. set-stage: keyboard activation of a tile hop, equipSlot value for each of the six slots.
3. fps-list: equip replacing an already filled slot; q preserved after the round trip; failed clear (only refused equip tested); returning highlights the slot (only a class asserted, L311).
4. set-gear: undo-window expiry (UNDO_WINDOW_MS, fakeAsync), undo write failure.
5. codex-set: rating/readiness refresh after an equip or clear (rating specs only cover initial load).
6. Signed-out visitor in equip mode; set owned by another user.

## 3. Flaky / slow patterns
- No failures or retries in this run; 35 s total is fast.
- About 66 fakeAsync/tick/setTimeout uses (hangar-picker 300/150 ms timers, share panel, undo window): deterministic under fakeAsync; watch hangar-picker, holo-stage/strip, ship-skin-viewer (rAF/WebGL) under CPU load or hidden tab.
- Karma renders at 749 px, so media-query assertions test the phone branch; only codex-detail-mobile-width and keybinds-mobile-width guard widths; no desktop-width spec for list/fps-list/picker.
- Many search specs call component methods or set signals (cmp.onSearch, searchTerm.set) instead of typing into the real input; a broken template binding would pass. Prefer the swap-picker style (dispatch input on the element).

## 4. Prioritized missing tests
P0 (user-visible search, no or thin coverage)
1. upcoming-grid.component.spec.ts: filters the grid by the typed term; no-match state + clear button restores all; seeds the box from ?q=.
2. codex-landing.component.spec.ts: typing in the archive terminal renders hits (DOM input); results.empty for a term without hits; clearing empties results; seeds from ?q=.
3. codex-list.component.spec.ts: seeds the search box from ?q= and queries with it; clear removes q from URL and reloads; empty-result state names the term; q on kind switch (define intent).
4. fps-list.component.spec.ts: clearing search removes q from the URL; empty state for an unmatched term; search is case-insensitive and trims.
5. keybinds.component.spec.ts: unmatched term shows a no-results message, not the no-build-published state; search works against English labels in EN mode.
6. codex-swap-picker.component.spec.ts: empty-table message when search matches nothing; search combines with scope and type chips; clearing restores rows; query reset/persist on reopen.

P1 (flow)
7. set/codex-set-flow.spec.ts (new, integration): tile -> arsenal equip -> back to set shows the piece; remove in set-gear updates rating/readiness; equip replaces a filled slot.
8. fps-list.component.spec.ts: q survives the equip round trip; failed clear shows an error.
9. set/codex-set-gear.component.spec.ts: undo window expires (fakeAsync); undo write failure named inline.
10. set/codex-set-stage.component.spec.ts: Enter/Space on a tile hops like a click; equipSlot correct for all six slots.

P2 (shared / hardening)
11. codex-search-normalization.spec.ts (new, table-driven across swap-table matcher, polyMatchScore, keybinds, fps-list): case, diacritics, whitespace, underscores/hyphens, wildcard, empty/1-char terms.
12. codex.service.spec.ts: raise 45%/35% (error branches, searchAll, countSearchMatches).
13. Specs for the 8 spec-less files listed above.
14. Desktop-width layout spec for codex-list/fps-list/swap-picker.
