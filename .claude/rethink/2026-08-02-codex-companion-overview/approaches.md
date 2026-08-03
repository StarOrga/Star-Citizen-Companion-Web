# Reconciled Approaches — Codex Overview as a Companion-Composed Briefing

*Date: 2026-08-02 · Step 5 of `/devops-rethink`. Three code-blind lens agents
(`product-value`, `ux-design`, `enduser-feel`) returned three approaches. This
document reconciles them against the actual codebase and labels blast radius
relative to the agreed corridor.*

---

## Part 1 — The shared spine

The three agents could not see each other's work or the code. They converged on
nine mechanisms independently. **Convergence at that strength is a finding, not
a coincidence** — these are not variants to choose between, they are the
architecture. Only Part 3 contains real choices.

| # | Mechanism | Why all three landed on it |
|---|---|---|
| 1 | **Overview = ranked cards, composed server-side, zero model calls on page load** | Ranking is what makes irrelevance *unrendered*. Density is solved by omission, not by layout. |
| 2 | **The model emits an intent / filter / panel-spec — never a fact.** Numbers are injected from our DB afterwards | Turns the "never invent game facts" no-go from a promise into a structural impossibility |
| 3 | **One input, two gears, no mode toggle.** Instant matches are free and local; the model fires only on explicit commit | The interaction rule *is* the cost control. You cannot spend money by accident |
| 4 | **No chat transcript.** An answer becomes a card in the same surface | Satisfies "must not read as a chat widget" by removing the message list entirely |
| 5 | **Closed intent catalogue** (8–12 intents; out-of-set gets an honest refusal) | An open catalogue is the same disease as the open link strip |
| 6 | **The filterable index dies as a destination, returns as a state** ("expand to full scan" / `list(filter)` / "lane sweep") | Browsing exhaustively and asking become the same surface |
| 7 | **Data gaps are a first-class card** with a contribute / watch action | Turns our biggest weakness into a contribution funnel |
| 8 | **Me / Ship / World are a tint and a scope, never a menu bar** | A menu bar can grow a fourth sibling; a closed tint cannot |
| 9 | **Viewers get the identical surface with the ask-gear switched off** | No second codebase, no separate design for phase two |

**Consequence for the decision:** the question on the concept page is not *which
architecture*. It is *how much of it we build first*, and *which of two layout
shapes* it takes.

---

## Part 2 — Reality check against the codebase

### ✅ Carries, no new plumbing

**Patch-delta is essentially free — and it is the signature feature.**
Every Codex table (`codex_ships`, `codex_weapons`, `codex_components`,
`codex_items`, `codex_ammunition`, `codex_manufacturers`, `codex_blueprints`,
`codex_keybinds`) is build-scoped: FK to `codex_builds(id)` plus a natural key
`(channel, patch_version, build_number, class_name)`. `ingest-catalog` only ever
deletes rows scoped to the *current* `build_id` (idempotent re-ingest) — it never
prunes older builds. **A diff between two builds is a plain SQL query.**

> Verified at schema + edge-function level. *Not* verified against production row
> counts: the headless-SQL recipe stored in memory is stale — the Windows
> Credential Manager entry `Supabase CLI:supabase` now yields a 22-character
> value that the Management API rejects as a JWT. First implementation step
> should confirm ≥2 retained builds in prod.

**Instant gear works with what exists.** `pg_trgm` is installed;
`CodexService.listByKind` already runs trigram-backed fuzzy search over both
`name_localized` and `class_name`. The free half of the input needs no new
search infrastructure.

**Lightweight 3D is incremental, not new.** The app already ships WebGL:
ship-skin viewer, GLB hardpoint hotspots, meshopt-compressed hulls served from
our own storage. A small animated companion sigil adds no new dependency class.

**Bilingual is solved.** Everything runs through ngx-translate with
`public/i18n/{de,en}.json`; the model's one connective line per card is the only
new translated surface, and it is generated per game event, not per user.

### ⚠️ Needs work, but is honest work

**`role` is a raw localization key.** `codex_ships.role` stores
`@vehicle_class_lightfighter`, not "light fighter". The *current* Bridge gave up
on it and groups by manufacturer instead — with an explicit code comment saying
role is "unreliable". It is resolvable through `codex_locale_strings`
(`resolveLocaleKeys` already exists), but any role-based intent depends on
finishing that resolution first.

**No "since you last looked" signal exists.** Ordering by *what changed since
your last visit* — proposed by two of three lenses — needs new state: a profile
column or local storage. Small, but not free.

### ❌ The honesty gap all three agents share

**There is no price data in the Codex schema. At all.**
`grep price supabase/migrations/*.sql` over the Codex tables returns nothing.
The brief's own showcase question — *"which ship for salvage under 3 million?"* —
**cannot be answered from our data today.** Prices exist only via the UEX Corp
proxy behind the per-ship "where to buy" panel: an external API, queried per
entity, not a bulk-filterable column.

All three agents used that exact example to demonstrate success criterion 3.
None could know it doesn't hold. This is the single most important correction to
make before implementation, and it forces a decision (see Part 4).

**The companion backend is entirely new.** No LLM integration exists anywhere in
the repo. New: an edge function, a provider abstraction (Grok first, per the
owner's choice of provider-agnostic-with-Grok-initial-config), an intent schema,
rate limiting, and the operator gate.

---

## Part 3 — The three approaches

### A — "Every Answer Is A Card" (product-value lens)

*The minimal cut. One deck of cards, six closed card shapes, ten fixed points,
eight intents. Editorial voice is one cached in-world line per card, generated
once per game event and shared across all users — so the voice budget scales
with game events, not with traffic.*

**Distinctive:** the cheapest possible route to all four success criteria.
Ruthless about what it drops.

**Its own biggest bet — and its conflict:** it explicitly defers the 3D presence
and strong animation, arguing they "move none of the four success criteria and
cost the most". **That contradicts an explicit owner requirement.** The agent
could not know that; it is a real trade-off, not an error — but it must be
decided consciously, not inherited.

- **Blast radius:** `new-approach` → **in-corridor**
- **Effort:** smallest of the three
- **Serves:** all four criteria; weakest on the "feels like a crew member" requirement

### B — "One Instrument Wall, Three States" (ux-design lens)

*One surface in three states — composed / answered / scanned. A variable-span
panel grid on an 88px module, like a cockpit MFD wall. The input is docked at the
**bottom** as a console rail. Nine fixed points. Twelve intents in three tiers
(Find / Explain / Act). Asking retunes the same wall: panels dim and blur back a
layer while answer-panels slide in on the identical grid. History is a "log
spine" of ticks on the screen edge; Esc drops one tick.*

**Signature design idea:** the **sigil and the scanline** — a ~120px low-poly
wireframe icosphere with a rotating inner gimbal ring docked to the console
rail; its states are legible without text (idle drift · ring locks when
listening · gimbal spins while thinking · pulse as panels land · **cracks open
and hollows when we have no data**). And it *draws*: every panel arrives with a
2px cyan scanline wipe, staggered 160 ms. Nothing fades in — everything is
scanned in by the companion. That one reused motion is what makes an unattended
overview read as *authored by a presence*, which is precisely what phase-two
viewers get with no conversation at all.

**Distinctive:** the strongest answer to "feels like a crew member, not a
chatbot", and the only one with a concrete three-width layout spec (phone 1-col
/ tablet 2-col / desktop 4-col at an 88px row module).

- **Blast radius:** `new-approach` → **in-corridor**
- **Effort:** largest — the grid system and the sigil are both real builds
- **Serves:** all four criteria; strongest on presence and on criterion 1

### C — "Watch Report Above, Comms Line Below" (enduser-feel lens)

*A single vertical stream of cards — a watch report already composed by the crew
member — with a 48px "line of sight" status line at the very top and a comms
line docked at the bottom edge. Cards expand in place; never a navigation, never
a modal. Nine intents.*

**Its unique contribution — the three-stage wait.** The model costs real
seconds, so the waiting is designed rather than hidden:
1. **< 150 ms, no model:** the parsed task renders as an *editable chip row*
   ("salvage-capable · price ≤ 3,000,000 aUEC") **and the deterministic result
   set is already on screen**. The data answer is ours; only the judgement is
   the model's.
2. **streaming:** the crew's line writes itself above the results.
3. **settled:** actions go live, card is pinnable.

The wait is never modal — you scroll and click stage-1 results while it thinks.
**If the model is slow, fails, or is rate-limited, stage 1 is still a real
answer.** That is the best resilience story of the three, and it directly
mitigates the cost/latency constraint.

Also strongest on the no-data beat: the sigil goes empty-handed, names the hole
scoped to a *source* ("no component data for the Idris in 4.3.1's archive — the
overlay would catch it in flight"), and offers exactly two exits: **contribute**
or **watch it**. A watch turns tomorrow's report into a payoff — a dead end
becomes a returning-user reward.

- **Blast radius:** `new-approach` → **in-corridor**
- **Effort:** medium
- **Serves:** all four criteria; strongest on latency, failure and first-run feel

---

## Part 4 — What the decision actually is

The spine is settled. Three real choices remain:

1. **Layout shape:** panel grid (B) or single stream (C)? *A is a scope-cut of
   either.* Grid reads more like an instrument wall and uses desktop width
   better; the stream is simpler, scales to phone without a second layout, and
   is faster to build.
2. **Presence in phase one:** build the sigil + scanline now (B/C), or defer it
   (A)? The owner asked for it explicitly; A argues it is the most expensive
   thing that moves no criterion. **This one needs an owner ruling.**
3. **The price problem:** criterion 3's showcase question is unanswerable from
   our data. Three ways out, all legitimate:
   - **(a)** pull prices from the UEX proxy into a filterable column at ingest
     time — makes the example work, adds an external dependency to the Codex;
   - **(b)** drop price from the showcase and demonstrate on constraints we *do*
     own (crew, cargo, hardpoint class, role once resolved);
   - **(c)** treat price as a *gap card* — the companion says we don't have it
     and offers the where-to-buy panel instead, which is honest and on-brand.

Everything else the three agents proposed is either shared spine or free
detail — reconcilable during implementation without another decision round.

## Part 5 — Fixed-point candidates (pooled, deduplicated)

The owner asked for creativity here. Pooled across all three lenses:

| Fixed point | Data status |
|---|---|
| **What changed under you** — build-diff ∩ your hangar | ✅ free (build-scoped schema) |
| **Ready to fly?** — flagship × current build: empty slots, vanished components | ✅ free |
| **First sighting** — entities that newly appeared in this patch's archive | ✅ free |
| **Broken-loadout alarm** — a component you actually use changed this patch | ✅ free (hangar configs exist) |
| **You, on foot** — armour/weapon set as a silhouette, empty slots glow | ⚠️ needs a personal-set concept |
| **Keybinds that moved** — "11 default bindings changed, 3 on-foot" | ✅ free (`codex_keybinds` is build-scoped) |
| **Horizon / promotion watch** — announced ships that *moved a stage* this build | ✅ exists (`rsi-upcoming-ships`) |
| **The gap card** — what we honestly lack, scoped to a source, with contribute/watch | ✅ free |
| **Fleet gap** — your hangar as roles covered, and the one role you have nothing for | ⚠️ blocked on role resolution |
| **The one upgrade** — the single slot where a strictly better part exists | ⚠️ needs a comparability rule |
| **A question worth asking** — crew-proposed, seeded from your own data, one tap | ✅ and it is how viewers get conversational value with no chat |
| **Manufacturer in the news** — entity-name match between news and our data ∩ ownership | ✅ free |
| **The bench** — configs you started and abandoned, comparisons left open | ⚠️ needs session state |
| **Dossier of the cycle** — rotating in-world editorial so a zero-config user still lands on content | ✅ free |
| **Line of sight** — patch level, verse up, archive freshness | ✅ exists |
