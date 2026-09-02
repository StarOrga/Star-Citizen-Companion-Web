# Reconciled approaches — AN BORD

Three code-blind lens agents returned three approaches. Reconciled here
against the actual codebase (`codebase-facts.md`, R1–R10) and against the
corrected data reality (R6).

## What all three agree on (the settled core — not a variant)

Convergence this strong is itself a finding: three agents that could not see
the code, given three different lenses, proposed the same mechanism.

1. **The slot is the control.** Each of the six anatomical positions is its
   own real, focusable, keyboard-reachable target. The zone stops being one
   stretched link. *(Forces R8: the zone-wide `<a class="zone-entry">` must
   be restructured — nested anchors are invalid.)*
2. **Slot → slot-filtered candidate list.** Coming from the helmet you can
   only see helmets. *(R1: `/codex/fps` already has this facet — a deep link
   plus an assign-context, not a new page.)*
3. **The equipped piece is pinned at the top of that list, every row shows
   its delta against it.** *(R2: the ship swap-picker already does exactly
   this and accepts `attachTypes` + `size`.)*
4. **Equip is one immediate write, no save button, with an undo notice.**
   *(R9: needs new shared toast/undo infrastructure — the SCC desktop app's
   "Undo-Toast v3" is the reference. R10: accepts a temporary split with the
   ship half's save-bar.)*
5. **Equip controls appear in exactly two places** — inside the assign flow
   and on a piece's own detail page — and nowhere in ordinary browse/search.
6. **The archive-depth counts (`676 · 471 · …`) are deleted** as a KPI. All
   three independently called them "our question, not the player's". Two of
   three relocate the count to the empty slot, where it reads as a promise
   (`412 im Archiv`) instead of trivia.
7. **`Waffengewalt` is deleted outright**, not restyled — personal weapons
   carry no comparable performance block, so there is nothing honest to
   aggregate.

## Where they genuinely differ (the real variants)

| | A · Figure Is The Picker | B · Rig Plate | C · Fitting Bay |
|---|---|---|---|
| lens | product-value | ux-design | enduser-feel |
| optimises for | least new surface | the zone as an object | safety + momentum |
| the figure | stays the star, slots are anchors | **recedes** into a lit niche; a bay rack dominates | stays the star, slots are sockets |
| assign flow | sheet over the landing; full page when opened cold | drawer opens **inside the plate**, other 5 bays collapse to spines | layer rises over the lower ⅔, figure stays lit above |
| fill state read as | filled/empty material state | **physical depth** — proud cartridge vs cut socket | open socket vs dressed body |
| undo | one snackbar | undo strip **extrudes from the plate bezel** | **two-tier**: snackbar **+ persistent "war: X" chip** on the slot |
| onboarding | — | — | **guided first fit** chains all six slots |
| signature idea | the intent lives in the URL, so equip **cannot** leak into browsing | character = chassis, gear = cartridges in bays | you are never punished for acting fast |
| blast radius | new-approach | new-approach | new-approach |

All three are **in-corridor** — the agreed corridor is "everything, including
the data model".

### A · The Figure Is The Picker
Sharpest structural idea: **the equip intent lives in the URL**
(`?slot=helmet&equipInto=<setId>`). Requirement 4 ("no equip buttons during
ordinary browsing") then needs no mode flag and no setting — it is
structurally impossible for a button to appear without an intent in the URL.
The picker is the *existing* browse view plus three additions, so search,
sort and filters come for free. Retires the old editor outright.
**Cost:** lowest. **Risk:** visually the least ambitious — it fixes gaps 1–3
of the four, and leans on the visual pass to fix gap 4.

### B · The Rig Plate
The only approach that actually answers gap 4 ("does not look the part").
One machined plate: figure recedes into a recessed well, a rack of six
cartridge bays dominates. Filled = a cartridge seated proud of the plate;
empty = you look *into* the socket, dark, with etched mounting rails and
`FIT HELMET · 412 im Archiv`. A half-built set reads as a gap-toothed rack
from three metres away, before a word is parsed.
Brings one rule worth keeping regardless of the variant chosen:
**diagonal hatching = "the archive carries no value here", flat empty = a
real zero** — a visual convention that makes no-go #1 enforceable by design.
**Cost:** highest (new visual language). **Risk:** the figure demoting to
atmosphere is a real product decision, not a style choice.

### C · The Fitting Bay
The only approach that takes the *risk* of instant-save seriously. Its
**two-tier undo** answers a genuine accessibility objection (auto-dismissing
toasts with actions rush and stress users, NN/g + Atomic a11y): the snackbar
covers the fast path, and a small persistent **"war: ARIA-P"** chip stays on
that slot for the rest of the session for the slow path. Adds **guided first
fit** — on an empty set the whole figure offers one action that chains the
six slots, which is the single best answer to "six empty slots and 676
helmets".
It also **deviates from a stated requirement, explicitly**: no warning dialog
inside the assign flow, because there the incumbent is already pinned and
every row is already a delta — a modal there would nag without informing.
The warning-with-comparison stays on the detail page, which is the only place
the incumbent is off-screen. *This deviation needs the owner's yes.*
**Cost:** medium. **Risk:** the persistent chip adds per-slot session state.

## Non-visual calls that need deciding independently

- **D1 · Undo model** — single snackbar, or two-tier (snackbar + persistent
  slot chip)?
- **D2 · Sharing** — link payload (zero schema, mirrors the ship side) /
  directed share table + `SECURITY DEFINER` username→id RPC (real inbox) /
  public gallery (needs RLS opening; #411 dec. 3 left it untouched).
  *(R5: `profiles` is self-read only — peer lookup does not exist today.)*
- **D3 · Data model** — keep free-text slots (works today, R4) or migrate to
  fixed anatomical slots + weapon slots.
- **D4 · Old editor** — retire / keep / specialise (#411 decision 2, open).
- **D5 · Protection numbers** — ship class-only now (R6), or first do the
  uploader-side `DamageResistanceMacro.*` resolution that would light up real
  resistances?

## The correction that reshapes all three info blocks

All three agents were briefed that armour carries "a damage-reduction value
plus resistances". **Production says otherwise** (R6): 0 rows carry
`DamageReduction`; `damageResistance` is an unresolved macro reference.
Therefore, from each proposed info block:

- **struck:** numeric protection value, per-damage-type resistance bars,
  "weakest against energy", any protection aggregate.
- **survives, and is genuinely good:** occupancy/coverage with the empty
  slots named *as links*; **armour class + class mix** from the macro name
  (Light/Medium/Heavy/SuperHeavy/Undersuit/Flightsuit — real ordinal data,
  and it makes "1× heavy mixed with 5× light" a legitimate observation);
  grade and manufacturer mix; set identity + handoff; "new in this build"
  as the one honest remaining use for the archive counts.
- **survives as a rule:** C's "what does this app *not* know?" line — a
  stated gap reads as integrity, a bare `—` reads as a bug.
