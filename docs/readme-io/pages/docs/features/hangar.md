---
title: Hangar
excerpt: Your personal fleet — owned and wishlist ships, named configurations, component loadouts and role kits.
---

The **Hangar** is your side of the Codex: the ships you own or want, and the
loadouts you build for them. It requires an account.

## Fleet

Add ships by searching the catalog from the Hangar, or from any Codex entry.
Every entry is either **Owned** or **Wishlist**, and can be moved between the
two at any time. The counts at the top show both totals.

Each hangar entry carries:

- a **pin** so it sorts to the front,
- free-form **notes**,
- a link back to its Codex entry,
- and the ★ if it is your **flagship**.

## On the drawing board

Announced ships have no catalog entry — the Codex is built from the live
build's data, and these hulls are not in the game yet. They live on their own
**concept wishlist**, shown as a strip at the top of the Hangar so watched ships
are the first thing you see.

Every tile there is marked as **not flight-ready** and links back to its
[announced-ship page](doc:codex), where the *Watch for my fleet* button adds and
removes it. You can still add a hull by hand further down the page, with an
optional link to its official RSI pledge page.

## Standard components

Every ship shows its **factory kit** — the components it ships with by default,
taken straight from the extracted game data (P4K) for the current catalog
build. If a ship has no recorded standard components in the current build, the
section says so rather than showing an empty guess.

## Configurations

A **configuration** is a named alternative loadout for one ship — `PvP fit`,
`bounty`, `cargo run`. Create as many as you like, pick a role, customise the
component loadout, and mark one **active**.

Loadout stats are computed as you go: weapons, shield pool, quantum range, and
how many of the ship's ports you have actually assigned.

## Role loadouts

Role loadouts are ship-independent kits — the gear you take for a job rather
than the ship you take it in:

`FPS` · `Mining` · `Salvage` · `Medical` · `Engineering` · `Combat` ·
`Cargo` · `Exploration` · `Racing` · `Multipurpose`

Each kit has slots (with custom slots if the defaults do not fit) and tracks
how many items are equipped.

### The set page

Every kit has its own page in the Codex, `/codex/set/<id>`; the set block on
the Codex stage links there. The kit's figure stands in the middle of the
stage, and the six armour positions hang around it, each joined to its body
part by a line: the tile shows the part's icon and the equipped piece, the
position's name appears on hover. Hovering a tile lights its part on the
figure, and hovering a part lights its tile. The readiness icons in the
corner cover only what the role can hold: an FPS kit shows primary, secondary,
melee and throwable, an engineering kit a single gadget icon.

- **Einordnung (rating).** Next to the stage, the kit is placed against every
  armour piece of the same kind in the current build, in the categories CIG
  presented at CitizenCon 2954 (protection, mobility, stealth, active scan,
  g-force, EVA) and in a second profile for environment and carrying capacity
  (heat, cold, radiation, scrubbing, carrying capacity). The values come from
  the game files. A category the game files do not carry yet (stealth
  signatures, active scan, EVA mobility) is shown as a gap, never as a
  guessed number. When one piece limits the whole kit — an undersuit that
  only takes −30 to 60 °C under armour rated for −90 to 115 °C — the card
  says so.
- **Einsatz (lens).** Below the stage a lens picks what matters for a job
  (combat, stealth, pilot, environment, transport) and writes the relevant
  value onto every tile. EVA and scanning stay disabled until the game files
  carry their values. The lens is remembered per kit.
- **Equip from the Arsenal.** Every position links into the on-foot Arsenal
  (`/codex/fps`) with the kit attached; the tile grows into the Arsenal's
  header, which shows the kit and the position. The list then offers only the
  pieces that fit that position, each card equips straight into the kit, and
  equipping an armour piece leads back to the kit the same way.
- **Weapons in a fixed order.** Weapons and tools sit in a numbered row in a
  fixed order (for an FPS kit: 1 primary, 2 secondary, 3 sidearm, 4 melee,
  5 throwable), so a position is always where you expect it.
- **FPS positions.** Next to primary, secondary and sidearm, an FPS kit has a
  melee position (knives) and a throwable position (grenades). A medical kit's
  medgun position takes the ParaMed.
- **Clearing is safe.** Emptying a position offers *Undo* for five seconds. If
  the position was changed in another tab meanwhile, nothing is deleted: the
  page shows what the position holds now.

## Alpha caveat

Hangar contents live in tables covered by the alpha-phase data policy — see
[Accounts & data](doc:accounts-and-data). A schema rewrite can reset them.
Treat elaborate loadouts as replaceable until the project reaches beta.
