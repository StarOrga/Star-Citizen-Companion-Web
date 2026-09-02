# Reconciliation facts — what the codebase already gives us

Gathered in Step 2/5 of the rethink. These are the reality checks every fresh
approach gets measured against.

## R1 — A slot-restricted browse view already half-exists
`/codex/fps` (`fps-list.component.ts`) has a **category switch (weapon/armor)
and an armour-slot facet** driven by `fpsArmorSlot` / `fpsArmorAttachType`
(`codex.service.ts:1198-1205`) which map `Helmet ↔ Char_Armor_Helmet`.
→ The "type-restricted view" is a **deep link + an assign-context flag**, not
a new page. Cheapest possible path for requirement 2.

## R2 — A compare-and-swap table already exists
`codex-swap-picker.component.ts` (766 lines): candidate table with stat
deltas vs the equipped item, facets, sorting, columns. Built for ship
hardpoints, but `SwapTarget` already carries `attachTypes` + `size`, and
armour items carry `attachType`. → Reusable for the replace-warning
comparison (requirement 4) with modest adaptation.

## R3 — A floating compare tray already exists
`codex-compare-tray.component.ts`: up to 4 pinned entities, real side-by-side
stat table, survives navigation, already imported by both the landing and the
FPS list. → Serves the "comparable" success criterion for free.

## R4 — The storage model does NOT block per-slot assignment
`hangar_role_loadouts.items` is JSONB `[{slot, className, kind}]` with **free
text slots**. But the six anatomical slots are already a fixed spec
(`ARMOR_SLOT_SPECS` in `codex-landing-kpi.ts:198`) mapping roleSlot →
attachType. Note torso is stored as `core`.
→ Requirements 1–5 need **no schema change**. The corridor permits one, so a
migration to fixed slots is an *option*, not a necessity.

## R5 — Sharing is the one genuinely blocked ask
`profiles` RLS = **self-read only** (`profiles_self_read`, 00001) plus an
admin-read-all. There is a unique `username` column + `set_username` RPC
(20260706221138) — identity exists, **peer lookup does not**.
Three share models, very different cost:
- **(a) Link payload** — encode the set into a versioned URL param. Zero
  schema, zero RLS. Mirrors what the ship side already does (#411 dec. 3).
  Recipient must be signed in anyway (blanket `canActivateChild` guard).
- **(b) Directed share** — new `loadout_shares` table + SECURITY DEFINER
  username→id RPC (never exposing `profiles`). Gives a real inbox.
- **(c) Public gallery** — needs RLS opening; #411 decision 3 deliberately
  left this untouched.

## R6 — CORRECTED: no protection NUMBER exists, but a real armour CLASS does
Queried against production (`hcnqhvzlavdycidqyaai`, 2026-09-01). This
**overturns** the earlier assumption that #253 lit up armour numbers:

| check | result |
|---|---|
| `Char_Armor_*` items | 9 539 |
| carrying `SCItemSuitArmorParams` | 2 270 (~24 %) |
| carrying `DamageReduction` | **0** |
| backpacks with armour params | **0 of 540** |
| only numeric field | `integrityMilestoneToBreak` = 0.1 for **all** rows → useless |

`SCItemSuitArmorParams.damageResistance` is stored as an **unresolved macro
reference**, exactly as `.claude/deep-knowledge/p4k-format.md:56` warns:
`{_RecordId_, _RecordName_: "DamageResistanceMacro.MediumArmor", _RecordPath_}`.
Same for `restrictedMoveViewPenalty` →
`MoveViewRestrictionPenalty.MoveViewRestriction_Armor_Medium`.
`DamageReduction` exists **only in the uploader's test fixture**
(`test_armor_stats.py`), never in real data.

**But the macro name itself is honest, structured, ordinal data:**

| armour class | pieces |
|---|---|
| LightArmor | 773 |
| MediumArmor | 575 |
| HeavyArmor | 560 |
| UndersuitArmor | 262 |
| HeavyArmorUtility | 53 |
| CombatFlightsuitArmor | 42 |
| SuperHeavyArmor | 4 |
| DefaultDamageResistance | 1 |

→ **Consequences.** A numeric "Schutzwert", per-damage-type resistance bars
and any protection aggregate remain **forbidden** by no-go #1. What *is*
derivable and genuinely useful: **armour class per piece and the class mix of
a set** (incl. the real observation "1× heavy mixed with 5× light"), plus
grade and manufacturer from promoted columns. Also checked: armour inventory
containers carry **no numeric capacity** — no carry-capacity KPI either.
→ The only path to real numbers is an **uploader-side task**: resolve
`DamageResistanceMacro.*` (8 distinct records) during extraction. Scoped and
cheap, and it would light up every protection figure the three approaches
assumed — but it is *not* part of this rethink's web-side scope.

## R7 — The old edit path is explicitly up for retirement
`RoleLoadoutEditorComponent` (283 lines) + `HangarItemPickerComponent` are
today's only write path. Issue **#411 decision 2** leaves their fate open
("stay, be replaced by the codex page, or specialise"). The agreed corridor
now covers deciding it.

## R8 — Hard constraint: the zone is ONE stretched anchor
The whole AN BORD zone is wrapped in a single
`<a class="zone-entry" routerLink="/codex/fps">`, and the paperdoll slots are
bare `<rect>`/`<circle>` inside an SVG. Per CLAUDE.md every navigation must
be a real anchor.
→ Per-slot targets must become real `<a>` elements, which means the
zone-wide stretched link **must be restructured** — nested anchors are
invalid HTML and the stretched link would swallow every slot target.

## R9 — No toast infrastructure exists in the web app
Grep finds only ad-hoc toasts (shell slow-load HUD, admin). The SCC desktop
app has the reference implementation ("Undo-Toast v3": bold *Rückgängig*,
5 s auto-dismiss, prior-value snapshot).
→ Instant-save + undo needs a **new shared toast/undo service** — new
cross-cutting infrastructure, not a local widget.

## R10 — Two write models on one page
Ship half = draft map + save bar (`codex-loadout-draft.ts`,
`codex-loadout-save-bar.component.ts`, "n von m speicherbar"). Owner decided
instant-save+undo becomes the app-wide model, on-foot first. Accepting a
temporary split on one page is a conscious trade, and should be stated as
such on the concept page.
