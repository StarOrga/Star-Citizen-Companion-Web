# Rethink Brief — "IM VERSE" plane of the Codex start page

Date: 2026-09-02 · Owner-validated (question round on the concept page, iteration 1) · **Code-free by design**

---

## 1. Product context

The product is a companion web app for the space game *Star Citizen*. Its
"Codex" is an in-app reference archive built from data mined out of each game
build: every ship, weapon, component and piece of personal equipment the game
currently contains.

The **Codex start page** is a *scale ladder* — three stacked planes that zoom
outward:

1. **AN BORD** ("on board") — *you*, the character on foot: what you are
   wearing. Accent colour: amber. Just rebuilt; must not change.
2. **IM HANGAR** — *your ship*: which one is selected, how it is fitted, your
   fleet. Accent colour: cyan. Must not change.
3. **IM VERSE** (renamed from "Im Versum") — *the wider universe*: the entry
   into the whole archive. **This rethink covers plane 3 only**, plus the
   seam between it and the panel above.

Planes 1 and 2 share **one closed, floating panel**: a box with a thin cyan-ish
border and a faint glow on a dark navy canvas. Inside it, each zone has a 2px
left edge in its accent colour and a small, uppercase, letter-spaced eyebrow
("AN BORD", "IM HANGAR") in that same colour. Type has three roles only:
label (small, spaced, uppercase), value (normal), name (large). The feel is a
sci-fi terminal: flat surfaces, thin borders, colour used sparingly and with
one meaning each, motion only while loading.

### What the archive actually knows (hard facts — respect these)

- Seven entity families with live counts: ships 353 · personal items 20,015
  (a catch-all: armour, clothing, personal weapons, consumables) · ship
  components 2,172 · weapons 1,312 · blueprints 1,595 · manufacturers 1,148
  (a data-mining namespace, not the ~30 brands a player knows) ·
  ammunition 238.
- Every family opens the **same browsing view** with that family preselected.
  There is currently **no entry into the unfiltered whole archive**.
- Build metadata exists: patch version, extraction date. The previous build's
  counts are already loaded too, so an honest one-liner "since patch X:
  +N ships, +N items" is possible without new data.
- An **announced-ships feed** exists (concept hulls the game does not contain
  yet, newest announcement first, with artwork). An internal view listing them
  exists; today the rail's tiles only link out to the publisher's site.
- **Not in the data, never to be shown:** locations, missions, prices,
  popularity, organisations, player statistics.
- About 94% of archive entries have **no artwork**. Ships and announced ships
  do.

### Neighbours of this plane (context only, out of scope)

- A global **search terminal** at the very top of the page searches all
  families at once.
- A **status pill** next to it shows the current patch number.
- A **keybindings** reference page exists; its link currently sits in this
  plane's header and will move to the terminal row at the top. **Assume it is
  gone from the plane.**
- **Verse News** is its own top-level area of the app — not to be duplicated.

---

## 2. Today's state (what the owner sees)

- Eyebrow "IM VERSUM" in grey, a key icon far right on the same line.
- One wrapping row of **seven small transparent pills**: a 17px line glyph in
  a per-family colour (cyan, gold, cyan, orange, grey, grey-blue, red), the
  family name, a small grey count. A frame appears only on hover.
- Below: a title "Auf dem Reißbrett" ("on the drawing board") and a horizontal
  rail of 16:9 art tiles for announced ships.
- Separation from the closed panel above: a plain 20px gap — the same gap that
  separates unrelated blocks elsewhere on the page.

---

## 3. The gap (owner confirmed all eight)

1. **Goal:** the plane is the third rung — step out into the universe: enter
   the archive by family, see what is announced — and it must read as the
   *same ladder* as the two planes above.
2. **"Fiddly" is a size/weight decision:** nothing in the row carries weight;
   it reads as a filter bar, not a plane.
3. **The icons are not staged:** seven naked glyphs, no shared frame, plinth
   or hierarchy — a sample sheet, not a wayfinding system.
4. **Two colour systems collide:** the pills use a taxonomic system (seven
   hues for seven families); the ladder above uses a hierarchical one (one
   accent per plane, one meaning each). The third rung is the only one
   without a colour identity of its own.
5. **"Detached" comes from the missing seam, not the missing frame.** A
   closed panel, then a neutral gap, then something frameless. Frameless was
   a deliberate choice and *may* stay — but it is **not locked**; an approach
   may reconsider it.
6. **Circling:** four previous rounds reshuffled the same seven entries (big
   number tiles → icon tiles / share bars / compact strip / rows → horizontal
   chips, count demoted, section title removed). None gave the plane an
   identity.
7. **The plane lacks a statement, not content.**
8. **Rename:** the eyebrow becomes "Im Verse". Nothing else is renamed.

---

## 4. Biggest frustration (owner picked one)

**"The plane does not belong to the ladder — a panel above, nothing below:
two pages instead of three rungs."** An approach must visibly kill this.

---

## 5. Content decisions (owner decided — these are requirements)

- **Ships · Weapons · Components · Blueprints** stay as the primary entries.
- **Manufacturers** are no longer an entry of the plane; they become a facet
  inside the browsing view.
- **Ammunition** stays reachable, but secondary.
- **"Items"** stops posing as a family: it becomes the entry into the
  **unfiltered whole archive**.
- **The Reißbrett rail stays inside the plane**; its title becomes a link to
  the internal announced-ships view.
- **Patch delta: yes, but quiet** — one line such as "since patch X: +N ships,
  +N items". Explicitly *not* a hero element.
- Not wanted: an archive total as a headline number; a domain-scoped search;
  anything from the "must never" list in section 1.
- **Owner's own direction, verbatim (translated):** *"Maybe it should be
  grouped — by manufacturer / purpose etc. is a different thing than human
  equipment vs. ship equipment… short links vs. the total archive: the whole
  area should be the thing you click to get to the archive."* Read this as two
  distinct axes: **what kind** (person gear · ship gear · plans) versus **how to
  slice** (manufacturer, purpose — facets, not entries). And: the plane could
  be one clickable "whole archive" surface with grouped short links inside it,
  rather than seven equal pills.

---

## 6. Success criteria (owner picked)

- **Reads at a glance as the third rung.** Own accent colour, own edge or
  seam, visible continuity with the panel above — without merely boxing it.
- **The icons are staged.** One glyph family, one treatment (field, size,
  stroke), equal weight. No sample sheet.
- **Colour discipline.** At most one accent for the plane; colour no longer
  encodes the family.
- **Counts stay honest side information.** Tabular, quiet, never as bars or
  ratings.
- **The Reißbrett rail visibly belongs to the plane**, not an appendix under
  the entries.
- **Phone:** no horizontal page scroll; everything reachable.

Explicitly *not* required: "make a statement about the universe" (the quiet
delta line is enough); "no taller than today" (the plane may grow in height).

---

## 7. No-gos

- No new data sources, tables or services.
- **Never invent a number.** No popularity, prices, locations, ratings. An
  honest gap beats a plausible-looking value.
- No imagery per family (no placeholder art tiles for entries without art).
- No second news feed.
- Every family entry keeps landing on the same browsing view with its filter
  preset.
- No skeleton/loading placeholders for rows that may legitimately stay empty
  (the announced-ships rail renders nothing when the feed is empty).
- Not locked (may be questioned by an approach): the ladder metaphor itself,
  and "frameless".

---

## 8. Demolition corridor (agreed with the owner)

**The whole plane.** Structure, content, the rail, the header, and the seam
to the panel above may be rebuilt from scratch. The panel above (AN BORD /
IM HANGAR) stays exactly as it is in content and layout; only the *transition*
between it and this plane (edges, gap, tint, continuity, whether the plane
becomes visually part of the same surface) is in scope. Re-cutting the panel's
own grid or moving its zones is **over-corridor** — allowed as a flagged
outlier, not as the main proposal.
