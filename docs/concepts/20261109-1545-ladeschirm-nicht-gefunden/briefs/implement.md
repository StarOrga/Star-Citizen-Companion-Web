# Implement brief — Ladeschirm & Nicht gefunden (Quantum-Sprung)

Decisions file: `../../20261109-1545-ladeschirm-nicht-gefunden-decisions.json` (rounds 1–3) plus
`payloads/0{1,2,3}.json`. The approved visual reference is **round 3**: `parts/d2-r3.html`. In the
built page its classes carry the prefix `q3-` (`rounds/03.html`). Reuse its CSS and its
keyframes, its streak field and its logo port, but write them as real Angular / static code. The
original `app-logo.svg` may be inlined with its own ids and gradients now. The mock only avoided ids
because of the concept engine.

Logo source of truth: `P:/Projects/Star-Citizen-Companion-App/modules/desktop/resources/app-logo.svg`
(animated SVG). Copy it into this repo, for example `public/brand/app-logo.svg`, with a comment
naming the source.

## Every user remark, verbatim

### Round 1 (favourite: Quantum-Sprung, d2)

- Start, spool arc: "lass den weg auch die striche maß ring drum herum...."
- Start, streaks: "reichtig cooole idee, ist perfekt!"
- Start pin on the centre mark: "Bitte hier vor allem als basis exakt die logo animation nehmen, siehe auch vc app loading scree!"
- Seite lädt, tunnel: "ne, das ist für mich eher eine animation für die gesamte seite im loading... wenn wir soweit sind wie hier dann gern eine zu dem was gleich angeziegt wird passende animation !"
- Seite lädt, phases bar: "weg"
- Lädt zu lange: "Gern hinweis, aber knakciger! wesentlich! und finde gut das hinten es langsam weiterläuft"
- 404 screen: "die seite gefällt mir noch gar nicht, für eine suche haben wir doch den subheader.Statt bekannte ziele einfach unten wie auf den anderen seiten auch verse, codex und hq / In der mitte eher weniger details aber schon gern ewesentliches , meintest du gern / 404 größer dargestellt / in szene gesetzt. Notbarke versteht man nnicht."

### Round 2

- Start, logo 180 px: "gut"
- Seite lädt, tunnel over the page: "ja ok! Aber dann hier ohne dire ringe nach außen!"
- Inhalt kommt: "leiber die tatsächliche silhouette nehmen!"
- 404 staging: "sehr gut! Genauso wie der loadings screen, aber dnan bitte langsamer machen! und übergang von ladescreen zu 404 berücksichtigen, und bitte nicht in der mitte oval machen! das logo ist dort rund und sollte auch so sein"
- 404 footer and Meintest du: "ja"
- Pin, Seite lädt page area: "die info ist redundant"
- Pin, Lädt-zu-lange title: "das ist mir zuuu thematisch, nicht zu überboardnend"
- Pin, Lädt-zu-lange line: "das benötigt man nicht nochaml diese info."
- Pin, Status pill: "wohin soll status führen !?"

### Round 3 (action: implement)

- Seite lädt (page-wide streak tunnel): "ne, lass uns das rausnehmen, im zweifel laden komponenten... das heißt hierfür nix designene"
- Inhalt kommt (Carrack silhouette arrival): "ne, nur silhouette, ohne davor sonne und sternchen etc. da drin!"
- 404 with its transition and tempo: "sehr gut!"
- Pin on the Start subline "Quantum-Antrieb spult auf": "quan... benötigen wir nicht!"

## Checklist (every accepted item)

### A · Boot splash (`src/index.html`, first paint, static HTML/CSS only)

1. [ ] Replace today's ring, word and bar splash with the round-3 Start screen.
   - The full-window **quantum streak field** stays exactly as in the mock.
   - In the centre sits the **animated app logo** at 180 px (150 px on phone), round-masked, with
     a cyan drop-shadow glow and the soft orbit glow behind it.
2. [ ] No spool arc and no tick/measuring ring.
3. [ ] The text is only the "Verse Companion" word. **No "Quantum-Antrieb spult auf" subline.**
4. [ ] `prefers-reduced-motion`: a still frame (static streak burst, logo still).
5. [ ] It stays inside `<sc-root>`, so Angular removes it on render. Self-contained: no external
   fonts or JS. Mind the CSP and the `check-native-ui` and other prebuild guards.

### B · Page loading

6. [ ] **No** page-wide loading animation. Round 3 drops it ("im zweifel laden komponenten").
   Components keep their own loading states. Do not add a route-level tunnel overlay.

### C · Content arrives: ship pages

7. [ ] On a Codex ship detail page, while the detail is still loading and the ship's silhouette
   is available (`SilThumbsService` / `sil-thumb`, real Codex silhouette data), show **only the
   silhouette** drawing in from the jump point (flash, stretch, outline draws).
   - **No** sun, stars, streaks or other backdrop inside that stage.
   - Hook it into the existing loading/skeleton branch of `src/app/codex/codex-detail.component.ts`
     (`loading() && skeletonStage()`). Other kinds keep today's skeleton.
   - Reduced motion: the outline appears without the animation.

### D · Takes too long

8. [ ] When a navigation (lazy chunk + route data) has been pending for about 8 s, show a calm
   glass card over the content area. It has the title **"Das dauert länger als sonst"** and no
   extra line.
   - Actions: **"Erneut versuchen"** as the primary `scAction`, which retries the navigation, and
     **"Zur Startseite"** as a secondary anchor to `/`.
   - **No Status pill.**
   - Behind it run the **slowed streaks**, without rings. This is the one place the streak field
     appears inside the app, as the round-1 answer "finde gut das hinten es langsam weiterläuft"
     accepted it.
   - It disappears when the navigation finishes. It must not collide with `RouteLoadRecoveryService`
     (chunk-error reload).

### E · Real 404 page

9. [ ] Replace `{ path: '**', redirectTo: 'verse' }` with a lazy `NotFoundPageComponent` inside the
   shell layout. The public layout applies when the user is signed out; check how the `PRIVATE`
   guards apply. The `''` → verse redirect stays.
   - Update `app.routes.spec.ts`. The AUD-144 relative-redirect pin only applies to the `''`
     redirect now.
10. [ ] Hero: a big **4 · round animated app logo · 4**. The logo is round, never an oval gate.
11. [ ] Entry transition, once, CSS only, ≤ 1.6 s, `animation-fill-mode: both`:
    - the fast loading streaks fade out;
    - the logo settles in as the 0;
    - both 4s land beside it.

    After that, **slower** streaks keep running.
12. [ ] Title "Ziel außerhalb der Karte", plus one line with the typed address and the unknown
    segment marked.
13. [ ] The one primary action is "Zurück zur Startseite".
14. [ ] "Meintest du" with at most two real suggestions as anchors, computed from the typed path:
    known top-level routes, plus Codex slugs when cheaply available. Hide the block when there is
    no sensible match.
15. [ ] **No** search field and **no** beacon. Verse · Codex · HQ come from the normal page footer.
    Do not duplicate them.
16. [ ] Not red anywhere. All strings go through i18n (`public/i18n/{de,en}.json`).
    - It renders an `<h1>` (sr text "404 – Seite nicht gefunden").
    - The page uses the page frame rules: no own `max-width` or padding on the root.
17. [ ] Reduced motion: no entry animation and static streaks.
18. [ ] Mobile: it works at 390 px, with nothing under the feedback launcher.

### F · Gates

19. [ ] Specs: the 404 route renders the component for an unknown URL and keeps `''` → verse.
    - The not-found suggestions are covered.
    - The slow-load card shows after the threshold (fake timers) and hides on completion.
    - The ship silhouette arrival renders only the silhouette.
20. [ ] `npm run typecheck`, `npm run lint`, the affected Vitest areas and `npm run build` (the only
    template gate) are all green.

Acceptance table expected from every builder: item → done / partial / not done → evidence
(file:line, spec name, screenshot path).
