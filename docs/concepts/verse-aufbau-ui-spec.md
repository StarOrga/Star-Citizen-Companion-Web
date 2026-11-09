# /verse build-up: living spec

Source: concepts `20261106-1513-verse-aufbau` and `20261109-1752-kamera-welt` (round 5, mock `d5-pb-main` / `d5-pb-nav` / `d5-pb-cycle`). Read this before changing how the hub builds; earlier rules are in `docs/performance-plan.md`, section 5.

## Accepted

| Visit | What it does |
|---|---|
| Direct call of the bare domain (`/`, no path; it redirects to `/verse`), first one in this tab | Cinematic entrance, seconds from the start (the start is after the boot splash has handed over): stars ignite 0 s, camera dolly from depth 0.8 s for 2.7 s, title light-edge scan with afterglow 2.2 s, search grows out of the title and is usable 3.5 s, header, Patches and the rest 4.3 s, "Mehr im Verse" breathes in 5.0 s, the page stands 5.5 s. |
| Same tab again (reload, a link to `/verse`, the bare domain a second time) | Short build, at most 0.8 s: stars, then the hub fades in as one once the story is there (400 ms wait + 400 ms fade). No dolly. |
| Through the menu (arriving from Codex / HQ ...) | The header stands. Title scan 0.75 s, search 1.05 s, Patches and notices 1.3 s, the three planets send an impulse one after another from 1.55 s (ring, 0.1 s apart). The page stands 2.3 s. |

- The claim is a tab flag (`sessionStorage` `sc.verse.entrancePlayed`), set when the cinematic plays. The entry URL is read from Navigation Timing (`documentEntry()` in `briefing.model.ts`): a bare `/` that is not a reload or history step. A path, a reload or blocked Navigation Timing means short.
- Any input ends the entrance within 300 ms (everything still on its way hurries to its end); the input itself still acts, typed keys go on to the search.
- **Projector cycle (every visit, `briefing-transmit.component.ts`)**: 5 s after the page stands, the planet with the newest content ignites (cone and panel, the existing projection), the panel stands 5 s, is projected away with the same animations reversed (unwrite, unbuild, uncharge, about 2.6 s), 5 s with no projection and no panel, then the next planet, newest first (publish dates, so the order changes from day to day), endlessly. A panel under the pointer or focus is held; a hidden tab, being away from the top and reduced motion stop it. The timers run outside the Angular zone.
- Planet names (News, Patches, Galerie) show only on hover and focus through `scTooltip`; on touch the first tap shows the name, the second opens the page. The planets stay real anchors.
- Reduced motion: no entrance, no dolly, no cycle.
- A door stays empty until its planet is drawn, then comes in 0.3 s. Without WebGL it shows its CSS art after 2 s.
- The hub renders in steps: stage and hero, then doors and beacons, then the columns (`staged-build.ts`).

- The shell takes the two beats as their own delays (`--sc-intro-search-at` 3.5 s, `--sc-intro-header-at` 4.3 s, `ENTRANCE_BEATS`); `--sc-intro-k` only paces the search's ignite (k = 1.52).
- One planet: the hub draws none. The scene's live planet stands where the hub's planet geometry (`.brief-world`) is, its News / Patches / Galerie pieces under the doors; the hub lends both rects to the scene (`SceneCameraService.setVerseAnchors`). Leaving the hub, the doors hand over to those pieces and the camera carries them.
- A menu switch into the hub plays only the hub's own sequence; the shell's general page rise (`sc-switch-in`) stays off there.

## Open (needs the shell)

- The dolly runs on the stage's own world; the scene camera follows `<html data-kw-entrance="dolly">` once its camera API exists.

## Rejected

- The full entrance on every reload: too long for each Ctrl+R.
- The full entrance once per day and device (2026-11-04): replaced by once per tab on a direct call of the bare domain (2026-11-09).
- The projector as part of the entrance (first message standing at once, next planet after 6 s): replaced by the cycle above.

## Measured

- Sporadic long frames when the app opens on `/verse`, some runs none at all: work in the GPU process (ANGLE worker tasks, raster flushes) while the main thread is free. Dropping the blur from the arrivals brought no provable gain in 14 alternating runs on a loaded machine, so the blur stays.
