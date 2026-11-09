# Round 4 input — handover from session "backlog" (2026-11-08)

Source: cross-session message from session "backlog" (branch `claude/backlog-76f33a`), relaying Jeremy's wish. That session redirects `/hq/hangar` (shell beta) to `/hq?bestand=hangar#inventar` and does NOT touch `hq-stock.component.ts`.

Bestand must absorb what only the old `HangarDashboardComponent` (`/hq/hangar`, `/hq/locker`) offered:

1. **Sets (FPS role sets).** In the beta, `/hq/locker` is the only place to see and create sets. The "Set anlegen" links in `codex/set/add-to-set.component.ts`, `codex/stage/hangar-picker.component.ts` and `hq/stock/hq-stock-shared.component.ts` point at `hqLocker`. Round 1 recommended (untouched): sets as the Inventar filter "Sets". Rounds 2 and 3 show a dimmed "Sets 0" chip. Round 4 must mock:
   - set tiles,
   - a "+ Set anlegen" entry,
   - the deep link that replaces `hqLocker`.
   
   Offer the 4th-tab alternative as a question. The set editor `/hq/locker/:id` stays. Once this lands, `/hq/locker` can redirect too.
2. **Import entry.** The dashboard had "Importieren…" (→ `/hq/hangar/import`, the browser-extension handover). Bestand › Hangar needs an entry for it, e.g. in the ⋮ menu as a real anchor.
3. **Dashboard-only features.** Check whether Bestand needs these:
   - the wishlist counter,
   - the variant list per ship.
