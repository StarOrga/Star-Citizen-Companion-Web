# sc-event-sheet fixtures

One JSON file per event: `event` (the `sc_events` row), `sources` (text the function would feed the model), `llm`
(the model's tool answer), `expect` (what the normalised, review-gated sheet must look like). Used by
`../extract.test.mjs` (`npm run test:functions`).

Honest provenance: no live recording was possible from the build session (RSI pages return only meta tags to a plain
fetch, the Anthropic key is a server secret). `sources` paraphrase the facts in
`docs/concepts/hq-events-research.md`; `llm` is hand-written the way the model is instructed to answer (open
capitalised ids, per-field confidence, deliberately a few mistakes such as a patch prerequisite or unsorted tiers) so
the normaliser and the gate are what is under test. To refresh with real recordings, run
`POST sc-event-sheet {"eventId": "...", "force": true}` as admin and paste the history row's sheet into `llm`.

Unknown stays unknown: Day of the Vara mask channel, Foundation Festival and Invictus rewards, Discovery Month end.

| File | Event | Covers |
|---|---|---|
| discovery-month-2956 | RSI Discovery Month (running) | Verse venue, Stanton system with any-of places, personal tiered progress on 4 tracks, pledge vs ingame per reward, after-end pledge paint, contradictory end -> pending/unknown, patch + package prerequisites dropped |
| day-of-the-vara-2956 | Day of the Vara 2956 (running, ends 9 Nov) | Arena Commander + website venue without area, once-progress, mask channel unknown + after-end |
| iae-2956 | IAE 2956 (13-27 Nov) | Free Fly without reward (`rewards: []`), ISO instants, place from secondary source stays pending |
| foundation-festival-2026 | Foundation Festival (29 Jul - 10 Aug) | rewards and area unknown |
| invictus-2956 | Invictus / DefenseCon (14-27 May) | venues Verse + website, weak "any" area pending |
| luminalia-2955 | Luminalia 2955 (10-22 Dec 2025) | website advent calendar (daily progress), pledge gift vs in-game payout, "RSI account" prerequisite dropped |

## Open question: Orison Relief

The research (section 2) names "Orison Relief" as an event that ended just before Discovery Month and may carry a
global/community counter, but no source in the research says what it was (dates, venue, progress, rewards). It could
not be looked up from the build session (no web access), so it is NOT a fixture and the "last 3 big events" are taken
as Invictus 2956, Foundation Festival 2026 and Luminalia 2955 plus IAE 2956 as the next one. If Orison Relief turns out
to be a community-goal event, add `orison-relief.json` with `progress.model = "community"` and a `group`/`community`
track; the schema already allows it (open model slug).
