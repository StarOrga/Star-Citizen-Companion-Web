# /verse build-up: living spec

Source: concept `20261106-1513-verse-aufbau`. Read this before changing how the hub builds; earlier rules are in `docs/performance-plan.md`, section 5.

## Accepted

| Visit | What it does |
|---|---|
| First visit of the day, opened on `/verse` | Full entrance: stars, name, header 1.9 s, search 2.3 s, sun 2.6 s, doors 2.9 s, comet from 3.6 s, first story at +0.8 s. The length stays. |
| First visit of the day, through the menu | The same scene; header and search already stand. |
| Reload, later start the same day | Stars, then the hub fades in as one once the story is there, at most 800 ms. The bar only after that. |
| Back through the menu | The hub's content rises in with the menu switch. |

- The holo sends only after the comet. On every other visit the first message stands at once and the next planet sends after 6 s.
- Any input ends the entrance within 300 ms and counts the day as seen; the input itself still acts.
- A door stays empty until its planet is drawn, then comes in 0.3 s. Without WebGL it shows its CSS art after 2 s.
- The hub renders in steps: stage and hero, then doors and beacons, then the columns (`staged-build.ts`).

## Rejected

- A shorter entrance (3.2 s or 2.4 s): the owner keeps the 4.2 s accepted on 2026-11-04.
- The full entrance on every reload: too long for each Ctrl+R.

## Measured

- Sporadic long frames when the app opens on `/verse`, some runs none at all: work in the GPU process (ANGLE worker tasks, raster flushes) while the main thread is free. Dropping the blur from the arrivals brought no provable gain in 14 alternating runs on a loaded machine, so the blur stays.
