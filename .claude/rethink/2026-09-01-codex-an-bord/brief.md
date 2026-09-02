# Rethink Brief — "AN BORD" zone of the Codex start page

Date: 2026-09-01 · Owner-validated (3 question rounds) · **Code-free by design**

---

## 1. Product context

The product is a companion web app for the space game *Star Citizen*. Its
"Codex" is an in-app reference archive built from data mined out of each game
build: every ship, weapon, component and piece of personal equipment the game
currently contains.

The **Codex start page** is organised as a *scale ladder* — three stacked
planes that zoom outward:

1. **AN BORD** ("on board") — *you*, the character on foot: what you are wearing.
2. **IM HANGAR** — *your ship*: which one is selected, how it is fitted.
3. **IM VERSUM** — *the wider universe*: entry points into the whole archive.

**This rethink covers plane 1 only.** Planes 2 and 3 stay untouched.

### What a "set" is, in this product

- A player keeps **personal equipment sets** that are independent of any ship.
- Each set has a free name and belongs to a **role**: on-foot combat, mining,
  salvage, medical, engineering.
- A player can own several sets and switch which one is the current one.
- Six anatomical positions make up the armour part of a set: **helmet, torso,
  arms, legs, undersuit, backpack**. Weapons are a separate concern that sets
  also can, but today barely do, cover.
- Only signed-in users can reach any of this. There is no anonymous view.

### What the archive actually knows (hard data facts — respect these)

- Each armour position has **hundreds of candidates** in the archive
  (roughly 130–680 per position).
- Armour pieces **do carry real numbers**: a damage-reduction value plus a
  set of damage-type resistances, and a manufacturer, a grade, and a
  weight class readable from the piece's identity.
- Personal **weapons carry no comparable performance block**. A rate of fire
  exists; armour-like protection numbers for weapons do not.
- Nothing in the data expresses "stealth", "signature" or "loudness" of a
  personal outfit. Those numbers do not exist and cannot be derived.

---

## 2. Today's state of the target (what the owner sees)

- The zone renders a **schematic human figure**, six positions marked on it,
  each with a leader line out to a small label: position name, the equipped
  piece's name (or "— empty —"), and a sub-line.
- Under the figure sits a **strip of key figures**. In an empty set it reads,
  literally: *"Occupied slots 0 / 6"*, *"Archive depth (empty) 676 · 471 ·
  451 · 460 · 219 · 138"*, *"Armour value —"*, *"Weapon force —"*.
- **Nothing in the zone can be operated.** The whole area is one single link
  that jumps to a general on-foot equipment browsing page. No individual
  position can be clicked, focused or keyboard-reached.
- To actually change a helmet, the player must leave this page entirely, open
  a different area of the app, open the set in a separate editor, and pick
  from an **unfiltered free-text search** that offers every kind of item at
  once — nothing narrows it to helmets.
- The two "—" entries are stale: the underlying armour numbers **now exist**
  in the archive. That blank is self-inflicted, not an honest data gap.

### Where the iterations circled

Seven consecutive releases reworked this zone's **appearance** — figure
artwork, which key figures to pick, framing, motion. Not one of them touched
its **interaction**. It has been a display case since the day it shipped.

---

## 3. The gap (owner confirmed all four)

1. **Display case, not a tool.** The zone shows state and offers no action.
2. **The figures under the figure answer no question.** Raw archive counts
   and two blanks; nothing a player can act on.
3. **The path to change a piece is far too long** and leaves the zone entirely.
4. **It does not look the part.** Reads thin and technical — like a dashboard
   widget, not like a piece of equipment in the game's world.

---

## 4. What the owner explicitly asked for

These are requirements, not suggestions. An approach must serve them (it may
propose a *better* way to satisfy the same intent, but must say so explicitly).

1. **Assign a single position directly** — e.g. the helmet — starting from
   the figure.
2. That assign action lands in a **type-restricted browsing view**: coming
   from the helmet position, only helmets are selectable, and there is a way
   back.
3. In that restricted view there is a **direct "equip" control per entry**;
   the same control also exists on an **individual piece's own detail page**.
4. Those equip controls **must not appear during ordinary browsing or
   search**. During ordinary use, adding a piece to a set is offered **only**
   on the piece's own detail page — and there it must **warn and show a
   comparison** when the action would replace something already in the set.
5. **Writes save immediately.** No save button. Every write raises a short
   **undo notice** (prominent "undo", auto-dismiss after a few seconds,
   restoring the previous value) so a mistake is always recoverable. This is
   the model the owner wants app-wide over time, starting here.
6. **Rethink the information block under the figure from scratch**: what
   should stand there, *why*, and which real use cases it serves. One use
   case the owner named: **showing/handing a set to another signed-in user of
   the same web app.**

### One consistency fact worth knowing

The ship plane of the same page already offers compare-and-swap for ship
parts, but writes through an explicit save step. The owner has decided that
immediate-save-plus-undo is the target model for the whole app, and that this
zone goes first.

---

## 5. Success criteria (owner picked all four)

- **One click to a change.** From the start page, a helmet is swapped in at
  most two clicks, without losing orientation and without *feeling* like the
  page was left.
- **Every number answers a question.** Each figure under the character
  answers "am I ready for *X*?" — no raw value whose only purpose is to prove
  data exists.
- **It reads as an equipment terminal.** The zone feels like a device inside
  the game world: material, depth, state legible at a glance — not a
  dashboard tile.
- **Shareable / comparable.** A set can be shown to another signed-in user
  and the two can be put side by side.

---

## 6. No-gos

- **Never invent a number.** If the archive does not carry a value, show an
  honest gap marker — never a plausible-looking derived figure. This rule is
  absolute and outranks visual appeal.
- Otherwise: **free hand.**

---

## 7. Demolition corridor (agreed with the owner)

**Everything, including the data model.** The zone may be rebuilt from
scratch; new views may be introduced; the separate set editor elsewhere in
the app may be retired or re-specialised; and the way sets are stored may be
migrated (for example from free-text position labels to fixed anatomical
positions plus weapons). Schema change is permitted.

Out of scope regardless: the ship plane and the universe plane of the same
page, and any change that would make the app show numbers it cannot honestly
derive.
