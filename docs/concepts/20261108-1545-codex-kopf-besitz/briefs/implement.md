# Implement brief: codex-kopf-besitz

Decisions log: [`../../20261108-1545-codex-kopf-besitz-decisions.json`](../../20261108-1545-codex-kopf-besitz-decisions.json).
Binding spec (mock markup + CSS): `rounds/01.html` (round 1, design d3 "Panel-Karte" card), `rounds/02.html` (round 2, **design d1 "Kennleiste"**, screens `d1-s1` … `d1-s4`). Generators that produced them: `gen-r1.js`, `gen-r2.js`. Built page: `docs/concepts/20261108-1545-codex-kopf-besitz.html` (http://localhost:8766/docs/concepts/20261108-1545-codex-kopf-besitz.html).

## The user's words, verbatim

Original request (chat, 2026-11-08), about the header area of a Codex/Hangar ship page (screenshot: title "AVENGER STALKER", "Nachschub 0" pill top right, "Meine Variante: a" primary button, "DATEN 4.10.2-LIVE.12913470 · schema 6" pill, patch select, four own-ship icons, a big two-box panel "Wunschliste → Hangar" with the primary "AUF DIE WUNSCHLISTE", and "Klassisch | Holotisch" alone at the right edge):

> lasss uns nochmal concepten wie wir codex subsieten, , schiffe oder anderes mit hangar und und co anzeigen, der markierte bereich!
> also egal ob im besitz oder nicht, aber so darf das unter klassich und holotisch nicht aussehen!

> Zudem sollte der teilen button bitte korrekt positioniert werden, das nervt micht!

Round 1 (favourite **d3 "Panel-Karte"**):

- Annotation r1-d3-s3-a1 (Q: "Gehört die Variante-Wahl hierher oder doch in den Kopf, weil sie die ganze Seite umschaltet?"):
  > variantenwahl in den kopf! Aber irgendwie gibt es im kopf ja einiges, einerseits welches schiff / gegenstand / welcher patch / im hangar ja nein / variante im hangar.
  > Das muss irgendwie in den kopf rein!
- Pin on d3-s3, title block:
  > nimm den datenstand hier komplett raus, wir haben das ja im admin panel für data uploads! das reicht, andere müssen das nicht sehen, die sehen nur den verkürzten stand in dem patch drop down
- Share decisions: Eckstapel **verworfen**, **Reihe mit dem Launcher miteinbezogen**, Im Seitenkopf verworfen, **Ein Teilen pro Seite miteinbezogen**.

Round 2 (favourite **d1 "Kennleiste"**, action implement):

- Pin on d1-s1, on the "Klassisch" button:
  > las uns klassisch / holotisch irgendwo anders hinpacken, wie wäre es als toggle fab über den feedabck fab rechts unten unter dem beta fab!?

No other notes; unanswered annotations stay as the mock shows them.

## Checklist (one line per accepted item)

Ship pages = the Codex ship detail (`/codex/…`, shell beta) and the hangar ship page (`/hq/hangar/:id`, which renders `sc-codex-detail`). Both views: Klassisch AND Holotisch.

- [ ] **C1 Kennleiste.** Head = title block left (eyebrow "Hersteller · Klasse", the page's `<h1>`), on the right ONE grouped control strip on the title's baseline: `[Patch 4.10.2-LIVE ▾] | [Besitz-Segment]`. Same strip in Klassisch and Holotisch, same place. (rounds/02.html `d1-s1`/`d1-s2`/`d1-s3`, classes `vk-strip`, `vk-sg`)
- [ ] **C2 Besitz-Segment, ship.** Owned: "⌂ Im Hangar" + inline variant select ("Variante a ▾") — the existing variant switch ("Meine Variante: a", now a big primary-blue button) moves here as a normal inline select, no primary tier. Not owned: quiet "◇ Nicht im Hangar"; click scrolls to and briefly highlights the ownership card ("Haben?"). (`d1-s1`, `d1-s2`)
- [ ] **C3 Datenstand raus.** The data pill ("DATEN 4.10.2-LIVE.12913470 · schema 6" / provenance build line) leaves the page head for everyone; the patch select shows only the short form. The admin data-upload panel keeps the full build info (check it is there; do not add it elsewhere).
- [ ] **C4 Ansicht als FAB.** Klassisch | Holotisch leaves the head and becomes a toggle FAB in the bottom-right corner: above the feedback launcher, below the β FAB (shell beta corners). It shows on ship pages only, toggles the view exactly like the old segment (same URL/state behaviour), `aria-pressed`/label + `[scTooltip]` naming the target view. (round 2 pin)
- [ ] **C5 Besitz-Karte.** On top of the Holotisch right panel (above Einordnung / Bauteile / Änderungen) and, in Klassisch, on top of the side column: not owned → "Haben?" with Wunschliste and Hangar (secondary pills; wished → quantity stepper + "Wunschliste öffnen"); owned → "Dein Exemplar": custom name, rename / note / pin / remove (remove = danger, confirm via ScConfirmService), Nachschub hint only when the ship sits in a Nachschub, "Im HQ zeigen", "Noch eins wünschen". NO variant select in the card. (rounds/02.html `d1-own`; round 1 `d3-own`)
- [ ] **C6 Altlasten weg.** The big item-path panel (Wunschliste → Hangar boxes with the primary "AUF DIE WUNSCHLISTE") leaves the head; its function lives in the card (C5). The floating "Nachschub 0" pill above the head on this page is gone (the mocks have none; a ship in a Nachschub shows the hint in the card). The own-ship icon row in the head (rename/note/pin/remove) moves into the card.
- [ ] **C7 Gegenstandsseiten.** Items (weapons, components, armor — the item-stage layout): same strip with `[Patch ▾] | [Im Inventar · 2×]` (or "Nicht im Inventar"), no view FAB (items keep their Silhouette | 3D-Modell stage switch). Ownership card "Dein Bestand" on top of the item panel: quantity stepper, "Im HQ zeigen", "Noch eins wünschen", remove (danger) — only actions the existing services support; anything without a backing service (e.g. note/pin for an inventory item) is left out and reported. (`d1-s4`)
- [ ] **C8 Teilen in der Launcher-Reihe.** The share FAB sits on the feedback launcher's centre line directly left of it; β (and the new view FAB) stack above the launcher. A page's own bottom strip (Holotisch) never lifts the share alone: the corner moves together or not at all (today `--sc-share-lift` lifts only the share — fix that). Phones keep a working layout (no overlap with the bottom bar, mobile gate).
- [ ] **C9 Ein Teilen pro Seite.** The Holotisch stage toolbar loses its "Teilen" (3D · Schema · Teilen). On ship pages the one share FAB shares the full Holotisch state (what `copyShareLink()` copies today: view + unsaved hardpoint changes); elsewhere it keeps URL + section anchor.
- [ ] **C10 Conventions.** All strings via ngx-translate (de + en), `scAction` tiers (no primary in the head), `[scTooltip]` for icon buttons, real anchors for navigations ("Im HQ zeigen", "Wunschliste öffnen"), page frame untouched, `--sc-float-bottom` / FAB lane vars for the corner, errors via `toErrorKey`.
- [ ] **C11 Living spec.** `docs/concepts/codex-schiffsseite-ui-spec.md` gets a section "Kopf, Besitz, Teilen (concept 20261108-1545)" with accepted / rejected items.
