# Implement brief — Verse rank follow-up (concept round 1, submission v1)

Source: `docs/concepts/20261114-0200-verse-rang-folgekonzept/rounds/01.html` (binding spec for wording and
intent), submitted 2026-11-14 with action `implement`. Branch `feat/verse-rank-followup` off main 6a8ec638.
Reality check: main moved by #1111 (codex atomic builds) only — no overlap with the verse area, no force.

## Decisions (verbatim from the payload)

| id | choice | untouched | user note |
|---|---|---|---|
| d-pace | `stars` — "Nach entzündeten Sternen steigen: Stufen bei 1 · 3 · 7 · 12 · 18 · 26 · 35 Sternen; Stufe 5 nach ≈ 3 Patches." | yes (recommendation kept) | — |
| d-suggest | `rewards` — "Neue Rang-Belohnungen vorschlagen und abstimmen: Top-Eintrag-Formular fällt weg; Admin sieht die Ideen mit Stimmen." | yes | — |
| d-news | `hub` — "Auch am Sternenkarten-Planeten im Hub zeigen: Ein Punkt am Planeten, schon bevor man die Karte öffnet." | yes | — |
| d-wall | `magic` — "Sanft leuchtende Linien und Schleier dazu: Sternbild leuchtet zart, dahinter ein blauer Hauch; Sterne bleiben echt." | no | — |
| d-formats | `all` — "Alle Formate ab Stufe 1 freigeben: 4K, Handy und Ultrawide sofort; Stufen verändern Inhalt und Stil." | no | — |
| d-anim | `keep` — "Label beim Hover reicht: Keine weitere Arbeit" (deviates from the recommendation `mini`) | no | — |
| d-comet | `main` — "x.y.z-Tipp vorne, Linien-Tipp als zweite Wahl: Sobald PTU/EPTU ein x.y.z kennt, tippt man zuerst darauf." | no | "kannst du das nicht aus den foren etc. erkennen auch wenn noch nicht der eptu draußen ist?" |
| d-comet-reward | `yes` — "Ja, Splitter in die Sonnensammlung: Drei Splitter ergeben eine kleine Sonne; zählt nicht als Stern." | yes | — |
| d-sat | `admin` — "Nur Admins, in Admin-Rot: So wie gebaut." | no | — |

General comment: none. Closing note: none.

## Work items and acceptance

### W1 · Rank by lit stars (d-pace)
- `RANK_TIER_AT` becomes `[1, 3, 7, 12, 18, 26, 35]` and counts **lit stars across all patch lines** (every
  constellation's lit stars summed), not completed constellations. Source of the count: the explorer state the
  rank page already loads (sum of each map's lit stars) — or a server field if the state already carries one.
- Rank page, crest, tour text, help ("?") and i18n speak of stars, not completed maps ("Noch 2 Sterne bis …").
- Accept: a test account with 5 of 7 stars on one map shows tier 2 (≥ 3) instead of "Noch kein Rang";
  `rankProgress` unit tests cover 0, 1, 2, 3, 34, 35, 40 stars.

### W2 · Reward ideas with voting from tier 5 (d-suggest)
- Remove the old "Top-Eintrag vorschlagen" form from the rank page (and its client service call). Keep the old
  backend table if others read it; drop it only if nothing else uses it (alpha policy, document in the migration).
- New: from tier 5, players can submit an idea for a new rank reward (short text, length-limited) and vote
  (one vote per user per idea, toggle). Below tier 5 the section shows the locked state with the tier name.
- Server: migration with table + RLS + security-definer RPCs; the tier-5 gate is enforced server-side from the
  same star count (no trust in the client tier).
- Admin sees the ideas with vote counts (the existing admin queue/feedback surface or the rank page's admin
  view, in admin red); admin can archive an idea.
- Accept: below tier 5 no submit/vote controls; at tier 5 submit + vote work; RPC rejects a sub-tier-5 caller.

### W3 · "New on the rank page" dot on the hub (d-news)
- The hub's star-map planet/beacon shows the same news dot as the star-map crest, driven by the same
  `rankNewsItems` / `readRankSeen` (localStorage) logic. Opening the rank page clears both.
- Accept: with an unseen item the hub planet shows the dot; after visiting the rank page it is gone; reduced
  motion → no pulse, dot stays.

### W4 · Magic wallpaper by default (d-wall)
- Default (no nebula reward): the own constellation's lines glow softly (a faint blurred under-stroke /
  halo behind the 40 % line) and a subtle blue veil sits behind the constellation. Stars stay realistic (no
  glints, no Milky Way, few bright stars), the constellation stays small at its spot.
- Deterministic render kept; update `constellation-render.spec.ts` (the airglow test asserts the new veil).
- Accept: rendered samples (4K, phone, ultrawide) look calm-but-magical; spec green.

### W5 · All wallpaper formats from tier 1 (d-formats)
- 4K, phone and ultrawide downloads unlocked from tier 1. Tiers 3 and 4 get content/style rewards instead of
  formats (the agent proposes two concrete cosmetic rewards that change what is drawn, e.g. older patch-line
  constellations as faint companions, a tinted line colour) — names and meanings in i18n, documented in the
  final report.
- Accept: tier-1 account sees all three download buttons; tier ladder lists the new tier-3/4 rewards.

### W6 · Hub animation (d-anim = keep)
- No work. Nothing in the hub ↔ star-map motion changes.

### W7 · x.y.z tip in front + earlier detection (d-comet + note)
- Comet track: when a target x.y.z exists, the x.y.z tip is the default/primary mode; the line tip is the
  second choice. Without a target x.y.z the line tip stays as today.
- Answer to the note: yes — Spectrum's patch-notes list already carries **Evocati** builds (and PTU) before an
  EPTU exists (`supabase/functions/patch-stability-sample/channels.ts`, persisted in `patch_channel_builds`).
  `verse_comet_version_info()` must take the newest running/announced x.y.z above LIVE from PTU, EPTU **and
  Evocati** (`patch_channel_builds` + `patch_versions`) before falling back to LIVE + 1.
- Accept: with an Evocati build 4.10.4 above LIVE 4.10.3 and no PTU, the target is 4.10.4; tests for the SQL
  derivation (transaction-rollback probe) and any TS helper.

### W8 · Sun splinter for an x.y.z hit (d-comet-reward)
- An x.y.z tip that hits (same hit rule as the line tip's date window, resolved once the version reaches LIVE /
  its hotfix build starts) awards one **Sonnensplitter**; three splinters make one small sun in the sun
  collection on the rank page. Splinters never count as stars and never move the rank.
- Server: resolution function (idempotent) + the caller's splinter count in the explorer/comet state.
- Rank page: sun collection shows line-tip suns and splinters ("Splitter 1 von 3").
- Accept: SQL probe in a rolled-back transaction awards exactly one splinter per hit, never twice.

### W9 · Admin satellite (d-sat = admin)
- No change.

## Constraints
- Project rules from `CLAUDE.md` (i18n de/en for every string, `scAction`, `scTooltip`, real anchors, no
  native dialogs, `toErrorKey`, `--sc-accent-hot` for admin-only surfaces, no visible "Nur Admin" text).
- Migrations: new timestamp prefix after `20261114…` entries on main; `notify pgrst, 'reload schema'` after push.
- Gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:functions` when edge
  functions change.
