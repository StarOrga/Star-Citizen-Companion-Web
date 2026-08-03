# Rethink Brief — The Codex Overview, Composed by a Companion

*Date: 2026-08-02 · Target: the Codex front door of a Star Citizen companion web app.*

This brief is deliberately implementation-free. It is the ONLY context the
fresh-phase ideation agents receive, so it stands alone.

---

## 1. What the product is

A companion web app for **Star Citizen**, a space-sim game. It has three areas
today: a **news feed** of official game announcements and patch notes, the
**Codex** (an encyclopedia of everything in the game), and a **wallpaper /
desktop side product**. Signed-in users keep a personal **hangar**: the ships
they own or want, with per-ship configurations.

**Where the facts come from — this matters.** Every game fact in the Codex is
extracted from the game's own data archive after each patch by a desktop tool
and uploaded. Two further sources exist or are planned: an **in-game overlay
that scans what the player sees**, and **community-contributed data**. The app
never invents game facts. There is no third-party game API filling gaps.

The Codex covers: ships, ship components, personal (on-foot / FPS) weapons and
armour, generic items, ammunition, manufacturers, crafting blueprints, default
key bindings, ships announced but not yet flyable, and 3D ship liveries.

---

## 2. The target of this rethink

**In scope:** the Codex front door — what a person sees when they enter the
encyclopedia, how the topics inside are organised, and how finding things
works. Destinations *inside* the Codex may be re-cut, merged or replaced
where the new front door logically requires it.

**Out of scope:** the app's global top-level navigation, the news area itself,
the wallpaper product, and the extraction pipeline.

Server-side rebuilds are permitted. Changes to the desktop tool are permitted
if the front door genuinely needs them.

---

## 3. Today's state and the gap

The Codex front door is a landing page with a search field, one featured ship,
and horizontal rows of ship cards. Above that content sit **five stacked
horizontal bars**, including a flat row of **seven equally-weighted links** to
sub-destinations.

Measured on a 1280×720 desktop screen: **the first piece of real content starts
61 % of the way down the first screen.** The first content row is entirely below
the fold. On phones it is worse.

Those seven links have no organising principle between them. They mix
completely different kinds of thing side by side:

- a *tool* (the full filterable index),
- *subject domains* (on-foot equipment, crafting blueprints),
- a *time axis* (ships announced but not yet flyable),
- a *presentation format* (3D liveries showcase),
- a *reference table* (key bindings),
- and *personal property* (the user's own hangar).

**The circular pattern we are stuck in:** a previous rethink already replaced
an even worse front door (a raw filter list) with this landing page. Since
then, **every new feature has hung itself into that same strip** as one more
link or one more bar — on-foot equipment, liveries showcase, blueprints, key
bindings, upcoming ships, plus two promotional bars and a billboard. The front
door has no place to *put* a new topic, so new topics become new furniture at
the top. The strip only ever grows.

**The gap in one sentence:** the front door has no model of what the Codex is
*about*, so it degenerated into a shelf for links, and the content it exists to
show got pushed off the screen.

---

## 4. The target picture (the owner's own words, structured)

### 4.1 Three things a person wants to know about

Typically someone wants information about one of three things:

1. **Me, as a person in the game** — my character on foot: armour, personal
   weapons, my gear, my sets.
2. **My ship** — the ship I fly: its components, its loadout, my configurations,
   my fleet.
3. **The world** — the game universe: what's new, what's coming, locations,
   economy, manufacturers, how things relate.

In domains 1 and 2 the person has **their own sets / configurations**. In domain
3 they have **the topics they looked at recently**.

### 4.2 The companion composes the overview

The end state the owner pictures:

> A companion you can talk to, which presents you a **current overview**. The
> overview has **fixed points** and **variable parts**, driven by news and by
> individual configuration.

So the front door is not a static page with a search box bolted on. It is
**what the companion has assembled right now**. Fixed points are always there;
variable slots fill from what's happening in the game and from what this
particular person has configured. What isn't relevant right now simply isn't
rendered — that is what structurally solves the density problem.

**Fixed points named so far** (the owner explicitly asked for *more and more
creative* ones than this list):

- my flagship / my fleet
- current patch level and whether the game is currently playable
- me as a character (on-foot / first-person self)
- ships announced but not yet flyable

**Variable slots** are driven by: news events, patch changes, and the
individual's configuration and recent activity.

### 4.3 Search *is* the companion

One omnipresent input, two gears in the same field:

- **Instant gear** — type a name, get real matches immediately. Deterministic,
  fast, from our own data.
- **Conversation gear** — ask a real question, get a real answer grounded in
  our data, and follow it up.

And critically, the companion **acts**, it does not only answer. Intents to
work out include at minimum: put a ship into my hangar, connect an answer to
the relevant news, open a comparison, set or change a loadout. Working out the
full intent catalogue is part of this rethink.

### 4.4 It must feel like a crew member, not a chatbot

Two audiences, deliberately different surfaces:

- **Operators (the owner and collaborators)** see the conversation. It must
  **not look like a conventional chat window**. It should feel like talking to
  a virtual colleague — a crew member. **Strong animation and lightweight 3D
  presence are explicitly wanted** for this companion.
- **Viewers (regular signed-in users, a later phase)** do **not** see the
  conversation at all. They see the overviews the companion composed for them
  — **humanised, lightly gamified**, clearly authored by a presence rather than
  generated by a form.

The companion should read as a **Star Citizen companion** — in-world, in the
game's register — not as a generic assistant with a game skin.

---

## 5. Success criteria

The rethink has worked if, three months later:

1. **Content starts immediately.** On every device, real content — not
   navigation — occupies the first screen. *(This is problem number one.)*
2. **A new topic costs no new furniture.** When a new body of data arrives, it
   finds a home in the model without lengthening the front door. Note the
   owner's qualifier: "new topic" means **new game data** — from the game
   archive, from the in-game overlay scan, or from the community. It does
   **not** mean an infinitely extensible taxonomy that can swallow any
   conceivable sub-page. **A thematically coherent structure beats a universal
   one.**
3. **One question instead of five clicks.** A real question — "which ship for
   salvage under 3 million?" — can be asked in one sentence and is answered
   from real data.
4. **The companion acts.** From inside an answer: ship into hangar, news
   linked, comparison opened, loadout set — without leaving the view.

---

## 6. Hard no-gos

- **Never invent game facts.** Every number, name and stat comes from the
  extraction pipeline. The companion must never present a plausible-sounding
  value as game data. Where our data has a hole, the honest answer is that we
  don't have it.
- **Do not build a universal navigation taxonomy** that has a slot for every
  conceivable sub-page. Thematic coherence wins over completeness.
- The conversation surface must not read as a standard chat widget.

**Explicitly NOT protected** (may be redesigned or removed):

- The full filterable index. The owner explicitly wants it **rethought**, not
  preserved as-is.
- The current URLs of the sub-destinations.
- The current arrangement of the sub-destinations themselves.

---

## 7. Demolition corridor (agreed with the owner)

**In corridor:**

- The Codex front door — fully. Rebuild from zero is allowed.
- The Codex's sub-destinations — **to the extent the new front door's logic
  requires it.** If the new organising model implies re-cutting, merging or
  dropping a sub-destination, that is in scope. Re-cutting them for unrelated
  reasons is not.
- Server-side data shaping: new aggregation, new search behaviour, a
  server-side companion backend.
- The desktop tool, if the front door genuinely needs data it doesn't yet
  deliver.

**Over corridor (flag as outlier, do not assume):**

- Rewriting the app's global top-level navigation.
- Redesigning the hangar as a product area.
- Changing the news area.

---

## 8. Operating constraints

- **Rollout:** phase one is operators only (owner + collaborators) — they get
  the conversation. Regular signed-in viewers come later and get the composed
  overviews **without** the conversation surface. Design for both from the
  start; ship the operator surface first.
- **Language model:** the conversational intelligence is provided by an
  external language model, called server-side. The architecture is
  **provider-agnostic**, with **Grok (xAI) as the initial configuration**.
  Every call costs real money, so the design must account for rate limiting
  and for the answer being slower than a local lookup.
- **Two languages:** the app is fully bilingual (German and English). Every
  piece of user-facing text is translated. The companion must work in both.
- **Alpha phase:** the product is in alpha. Data shape may still change.
  Breaking changes are acceptable when they buy a better model.

---

## 9. Open decisions (deliberately unresolved — for the concept stage)

- What exactly the fixed points of the composed overview are, beyond the four
  named. *The owner asked for more creative ones.*
- How the instant gear and the conversation gear share one input without
  either feeling bolted on.
- The full intent catalogue the companion can execute.
- What replaces the filterable index for people who want to browse
  exhaustively rather than ask.
- How the companion behaves when our data genuinely does not contain the
  answer.
