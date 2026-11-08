# sc-event-sheet fixtures

Seven events, one JSON file each: `event` (the `sc_events` row), `sources` (text the function would feed the model), `llm`
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
| orison-relief-support-2956 | Orison Relief Support (4.10.1, past) | place-bound area (Orison), six-tier personal track with in-game rewards per tier, wiki-only end pending, cargo OR combat OR salvage gear, community-track conflict |
| luminalia-2955 | Luminalia 2955 (10-22 Dec 2025) | website advent calendar (daily progress), pledge gift vs in-game payout, "RSI account" prerequisite dropped |

## Orison Relief Support (answered)

Orison Relief Support (Alpha 4.10.1, 2026-09-16, bound to Orison in Stanton) was a PU contract event with one personal
six-tier track and in-game, account-attributed rewards - the last big reward event before Discovery Month. It is the
seventh fixture; its facts come from web research on 2026-11-08 (patch notes comm-link 21330 and
https://starcitizen.tools/Orison_Relief_Support, mostly community sources): the end date is wiki-only (low confidence,
pending), prerequisites are a gear estimate (pending), the replaced PTU community track (288 000 -> 72 000) must not
beat the personal track (test: a conflicting community claim does not win), and the FBL-8u undersuit at the last tier
is deliberately not in the rewards (single low-confidence claim). So the last three big reward events are Orison Relief,
Foundation Festival (Free Fly, no rewards) and Invictus, plus the two running ones and IAE 2956 as the next.
