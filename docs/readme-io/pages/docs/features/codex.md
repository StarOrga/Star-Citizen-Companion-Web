---
title: Codex
excerpt: Every ship, weapon, component, item, ammo, manufacturer and crafting blueprint — datamined from the live build and searchable.
---

The **Codex** is the reference half of SC Companion: ships, weapons,
components, items, ammunition, manufacturers and crafting blueprints, extracted
from the live game build rather than transcribed by hand. It is public — no
account needed.

## The headline: playable state and patch

The top of `/codex` states two things in one line: whether Star Citizen is
**playable right now** — the same live server status the app header reports —
and **which game patch** the archive below it was extracted from.

That patch label is also a switch. Open it for the last five patches, with
*Load older* paging five more at a time. Every entry says whether we hold
extracted data for it: patches with data can be selected and put the whole
Codex on that build, while patches that only ever arrived as an upload are
listed but marked *no data*, because there would be nothing to show. Reloading
the page returns you to the live patch.

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

#### Weapons: FPS gear and ship weapons in one tab

The **Weapons** tab holds *both* catalogs — everything a character carries and
everything that bolts onto a ship — because the game stores them in a single
weapon record type. In the current live build that is roughly two thirds ship
weapons to one third on-foot gear.

To make that browsable, the tab opens on a two-level category rail rather than
one flat A–Z grid:

- **FPS gear** → sidearms, primary weapons, heavy weapons, melee, throwables,
  gadgets & tools.
- **Ship weapons** → guns, turrets, missile racks, countermeasures, mining
  lasers, tractor & salvage heads.

Both levels are cut from fields the extract already carries (the weapon's class,
its carry class and the hardpoint type it mounts to), each category is badged
with how many records the current build holds in it, and picking one narrows the
query on the server — so paging and the remaining facets keep working exactly as
on every other tab. Categories the build has nothing in are not offered.

Ship **components** (power plants, shields, coolers, quantum drives, thrusters …)
are not part of this tab; they have their own *Components* tab in the same strip.

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

Action and category names are shown in your app language, with a **DE | EN
switch** next to the search box to read them in the **English original**
instead. Most players run the game client in English, so the original wording
is what you actually see in-game. Both name sets come from the datamined
language files — nothing is translated by us — so an action the game never
localized falls back to a readable name derived from its internal key, in
either mode. The switch also applies to the curated category labels, and it
disappears when the app already runs in English.

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

### The announced-ship page

Every announced ship — on the *On the Drawing Board* rail of the Codex landing
page as well as on the Upcoming cards — opens **our own page** for it at
`/codex/upcoming/:id`, not the RSI website. It shows everything the RSI ship
matrix told us (manufacturer, type, role, production status), says plainly why
there are no stats yet, and keeps the RSI pledge page as a secondary link.

From there you can **watch the ship for your fleet**. A watched ship lands on
the concept wishlist in [your hangar](doc:hangar), where it appears in the *On
the drawing board* strip at the top — always marked as not flight-ready, both
there and on the Codex rail.

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
