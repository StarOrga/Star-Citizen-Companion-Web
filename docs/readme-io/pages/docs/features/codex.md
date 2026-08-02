---
title: Codex
excerpt: Every ship, weapon, component, item, ammo, manufacturer and crafting blueprint — datamined from the live build and searchable.
---

The **Codex** is the reference half of SC Companion: ships, weapons,
components, items, ammunition, manufacturers and crafting blueprints, extracted
from the live game build rather than transcribed by hand. It is public — no
account needed.

## The Bridge

`/codex` opens on **The Bridge**, the browsing surface:

- **Scanner** — one search box that matches display names *and* class names,
  so both `Gladius` and `AEGS_*` work.
- **Featured hero** — your flagship if you have one, otherwise a highlighted
  ship, stamped with the patch and build it came from.
- **Lanes** — *Your Hangar*, *Fresh this patch* and *Explore by manufacturer*.
  Every lane is built from the ingested build; there is no hand-picked
  "featured ships" list anywhere in the app.
- **Compare** — add ships to a comparison tray and view them side by side.

### Index mode

`/codex/index` is the power-user escape hatch: the full filter list with kind
tabs, every facet, a result grid, load-more paging and the compare tray. One
click from the Bridge.

Kind tabs are driven by the build manifest: a kind the current build reports as
empty is shown greyed out with a *soon* marker, and everything the build
actually carries — blueprints included — is browsable.

## Ship detail — the stock loadout

A ship page shows its factory loadout as hardpoint blocks, the ones you can
configure first: weapons, remote turrets, missiles, countermeasures, pods,
shields, power plant, quantum drive, radar, coolers, life support — then the
fixed airframe below. Every occupied hardpoint reads as a component card:

- **Size class** — `S3`, or `3× S3` when several identical hardpoints carry the
  same item and collapse into one row. Shield bays and countermeasure launchers
  never collapse: each of them is a choice you make on its own.
- **Name** — the mounted item itself, e.g. *CF-337 Panther Repeater*, as the
  headline. Click it to open that item's own Codex page.
- **Maker · type** — e.g. `KLA · Gun`, plus the damage type for weapons
  (`ENERGY`, `PHYSICAL`, `DISTORTION` …) and the item grade.
- **Key stats for that type** — a gun shows alpha damage, projectile speed,
  range and penetration; a shield shows HP, regeneration and its regen delays;
  a quantum drive shows jump range, drive speed, spool-up and cooldown. Values
  marked `*` are derived (range, for instance, is projectile speed × lifetime).
- **Port** — which hardpoint it sits on, listed last as context.

A hardpoint the ship leaves unfitted is still listed — an empty bay is part of
the ship, not an absence of one. Where the data says what belongs in it (either
from the hardpoint itself or from an identical, fitted bay on the same hull),
the empty bay opens the same "what else fits here" picker as a fitted one; the
picker says when its list was inferred from a sibling bay.

### Shields, missiles and countermeasures

- **Shields** list every generator bay separately, plus the ship's shield
  **control module**, tagged as such. The control module is not a fourth shield:
  it manages the generators. The extract carries no "physical vs. logical slot"
  flag, so the page names what it does know — generator or controller.
- **Missile racks** show what they *carry* (`4` missiles at `S2`) next to their
  own size (`S4`), and — on a build extracted with a current Data Uploader —
  which missile is loaded in each station.
- **Guns mounted through a gimbal** name both parts: the mount is what bolts to
  the hull, and the gun it holds is listed under it as the sub-slot's occupant.
- **Countermeasures** (decoy and noise/chaff launchers) are their own block
  directly below the missiles, and are swappable like any other module.

### What the game data does not contain

Some numbers you would expect are genuinely absent from the extracted build
data, so the Codex omits them rather than showing a guess or a zero:

- **Fire rate, DPS, burst DPS and magazine size.** The game stores a weapon's
  fire action and ammo container in a record our extractor does not resolve
  yet — every ship weapon reports a fire rate of `0`. Without a fire rate there
  is no honest DPS.
- **Cooling rate and power output** for coolers and power plants.
- **Stock guns, on builds extracted by an older Data Uploader.** Those hulls
  show their gun mounts as unfitted, labelled "no stock weapon in this extract"
  and counted in a note on the Weapons block. The gap was on our side — the game
  names most factory-fitted items by an internal reference the extractor skipped
  — and it closes for good the next time that build is uploaded with a current
  uploader. A gun mount that is still genuinely empty keeps the label.
- **Which round a countermeasure launcher fires.** Decoy and noise *rounds* do
  carry their signature values (infrared, EM, cross section, cloud radius and
  duration), but no launcher in the build points at its round — so the Codex
  shows no per-launcher signature numbers rather than borrowing another
  manufacturer's.

These fill in by themselves as the extractor learns to resolve those records —
the UI already has a slot for each of them.

## Blueprints

`/codex/blueprint` lists the game's **crafting blueprints** — the datamined
recipes behind the crafting loop. Reach them from the Bridge link row, or as a
kind tab in Index mode alongside ships, weapons and the rest.

Each card carries its category (CIG's own buckets: FPS armor, FPS weapons,
vehicle components and vehicle weapons by size class, mission items), its tier
and its craft time. The category filter is built from the categories the current
build actually contains, so it never offers a bucket that returns nothing.

A blueprint page then shows the full recipe: tier, craft and dismantle time,
output quantity, and every ingredient with its quantity, role (primary,
secondary, catalyst) and minimum quality. Ingredients link to their own Codex
pages, and an item page links back to the blueprints that consume it.

## Keybinds

`/codex/keybinds` renders the game's keybinding tables from the extracted
default profile — useful when a patch quietly moves a binding.

## Upcoming Ships

Upcoming ships are a **category of the Codex**, not a separate page: pick
*Upcoming* in the category strip of the index (`/codex/index`, or the shortcut
`/codex/upcoming`), or open the *Upcoming* lane on the Codex landing page.

The category is the **difference between what RSI lists and what the live build
actually contains**: ships announced on the RSI ship matrix that have no match
in the datamined data yet. They are split into

- **In concept** — RSI is still building these, not flyable yet, and
- **Flight-ready on RSI** — RSI lists them as flight-ready, but our game data
  has no match.

You can search this list, filter to favourites only, and star ships to be
notified in [Verse News](doc:verse-news) when their status changes.

## Ship artwork

Ship cards show the ship's own artwork from the RSI website, matched by ship
name. Where RSI has no entry, the card falls back to the image extracted from
the game files — that one is the game's flat UI silhouette, which identifies a
hull rather than showing it, so it is the fallback and not the first choice.

Both sources publish image urls that can be missing, so a card carries a whole
list of candidates and tries the next one whenever an image fails to load — the
placeholder silhouette only appears once every candidate has failed.

## Where the data comes from

The Codex is populated from bundles produced by the
[Data Uploader](doc:desktop-tools) against a real `Data.p4k`, tagged with the
patch version and channel (LIVE / PTU / EPTU) they were extracted from. The
Codex is therefore exactly as current as the newest ingested bundle — the
freshness stamp on the hero tells you which build you are looking at.

Ships and components are also exposed over the
[Public API](doc:endpoints).

## Flagship

Pin any ship as your **flagship**. It then opens at the top of the Codex, is
marked with a ★ in your [Hangar](doc:hangar), and is stored on your profile so
it follows you across devices.
