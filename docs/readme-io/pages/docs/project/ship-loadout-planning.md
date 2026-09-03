---
title: Ship loadout planning
excerpt: What the ship page in the Codex is becoming — an editable loadout with honest numbers, designed to work for every ship in the catalog.
---

Today a ship page in the [Codex](doc:codex) shows the factory loadout and
nothing more: you can look, not build. The next step turns it into a planner —
swap any component, see what the change did, and compare candidates against
what is already fitted.

This page describes the design that has been settled. It is not shipped yet.

## The three ideas it is built on

**Deltas, not absolutes.** Every headline number carries its difference against
the factory configuration. What a build *is* answers a question nobody has
while building; what a change *did* is the one they do have. Reset a slot and
the delta chip disappears completely — never as "±0", so "untouched" and
"changed back to the same value" stay distinguishable.

**Every number is traceable to the game archive.** No wiki, no second planner,
no hand-maintained table. One source means one origin, one patch version, and
one thing to re-check after a CIG patch. Where a value genuinely does not exist
in the game files, the page says so instead of estimating — see
[Data Uploader](doc:desktop-tools) for where the data comes from.

**Describe, do not prescribe.** Where the page could hand out a score to
maximise, it shows a position instead. A percentage invites optimising toward
it, and the theoretical optimum is frequently a ship that cannot do its job.

## What the page does

**A mission lens, not a filter.** Pick Combat, Transport, Travel, Stealth,
Mining or Salvage and the page reorders its modules, folds what is not central,
and swaps the six headline figures. It never removes anything: every module
stays configurable under every lens — a quantum drive is still swappable while
the Combat lens is active. A mission the ship cannot fly is shown disabled with
the reason in its tooltip rather than hidden, so the row keeps its shape from
ship to ship.

**Folded means readable, not gone.** A folded module keeps a one-line preview of
what is fitted and what it contributes — "8× S2 StrikeForce II · 12.8k damage ·
0.1 s lock" — without the controls to change it. Unfolding restores the full
component detail: type, manufacturer, grade, every stat.

**Energy at a glance.** A compact dock carries the reactor budget, the
allocation per system group, cooling load and the IR, EM and cross-section
signatures, each with a tooltip explaining what it means and what moves it.
Cutting a whole group's power is one click. It can be minimised to values only,
and its position on screen is the reader's choice.

**Choosing is a comparison.** The component picker opens as a centred overlay —
the page stays visible behind it — and lists every reachable value per
candidate with sorting and filtering in the column headers, the same interaction
pattern intended for every table in the app. Values are shown against the
component currently fitted, switchable to the factory part.

## It has to hold for every ship

The design was worked out on a Nomad, because a concrete ship keeps the
decisions honest. But the catalog holds ships that look nothing like it, and
the layout has to survive all of them:

| Case | What it stresses |
|---|---|
| Light fighter | Few slots, no cargo hold — the page must not look empty |
| Capital ship with turrets | Dozens of hardpoints and nested turret chains — grouping and the per-slot toggle |
| Industrial ship | Mining and salvage hardpoints, little armament — the mission lens and its disabled chips |
| Ground vehicle | No quantum drive, sometimes no shields, no flight data — the gap notices |

The rules that make this work are the same ones above: sections exist only when
the ship has them, missions the ship cannot fly are disabled rather than
removed, and a missing value is labelled instead of filled with a zero.

## What is still open

Which of a weapon's roughly thirty values belong in the comparison table, how
the comparison scope decides what counts as a comparable component, and the
order in which the extractor is extended to supply the figures the page needs.
None of them change the design above.
