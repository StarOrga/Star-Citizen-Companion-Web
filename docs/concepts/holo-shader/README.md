# Codex 3D hologram look

The 3D hull viewers (asset package viewer and the legacy model-viewer path)
render one look, the concept hologram (`src/app/codex/holo-look.ts`). There is
no switch: the Studio and Blueprint variants of the concept study were dropped.

- **Body** (fill, scanlines, sweep band, crease lines) in the app accent, the
  same for every ship. Scanlines and sweep are quieter than in the study
  (`HOLO_SCANLINES`, `HOLO_SWEEP`).
- **Accents** (grazing Fresnel fringe, glow cloud, lit component, empty-slot
  ring, leader line) in the manufacturer colour from
  `src/app/codex/holo-manufacturer.ts` (class-name prefix, fallback = app
  accent, lifted to a minimum luminance).
- **Line density** follows the hull: `edgeDetail()` raises the crease angle and
  gates creases by triangle area from ~40 m / ~160 k triangles on, so a
  Reclaimer keeps its character edges and drops the greebles.
- **Highlight** (asset package viewer): the focused component renders as a lit
  model in the accent inside a glow halo, the rest of the hull x-rays. The
  label sits outside the projected hull (`holo-overlay.ts` `placeLabel`), links
  to the component's codex page and steps through the slots. An empty slot
  shows a rotating, pulsing dashed ring (static with reduced motion).

## Screenshots

| File | Shows |
| --- | --- |
| `final-gladius.png` | Gladius, idle |
| `final-reclaimer.png` | Reclaimer, idle (thinned lines) |
| `final-highlight.png` | Gladius, docked cannon highlighted with its label |
| `final-empty-slot.png` | Gladius, empty missile slot with its ring |
| `final-reclaimer-highlight.png` | Reclaimer, top turret highlighted |
| `A.png`, `reclaimer-A.png`, `highlight.png` | the concept study the look was picked from |

The final shots were taken with a local asset-package fixture (the real hull
GLBs from R2 plus a generated cannon part) through the dev override
`localStorage['sc.assetPackages.devBase']` (see `asset-package.service.ts`) and
a throwaway harness route, headless Chromium via Playwright, 1280 x 760.
