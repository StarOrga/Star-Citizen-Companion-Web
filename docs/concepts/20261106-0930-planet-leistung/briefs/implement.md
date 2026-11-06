# Implement brief: Planet-Leistung

Decisions: [20261106-0930-planet-leistung-decisions.json](../../20261106-0930-planet-leistung-decisions.json) (round 3 lands there with this brief).
Rounds: `rounds/01.html`, `02.html` (live demo, the binding look for the sparkle and the resume), `03.html` (the plan).

## The user's words, verbatim

- Original request: "der background planet ist sehr performance intensiv, lass uns btite devops analysieren oder concepten, ihn allermindestens nur auf 1/10 der notwendigen leistung zu bringen, lieber sogar noch mehr"
- Round 1, general: "also am ende gern dann eine variante mit visualisieurngen machejn, ich will mir leive hier erstmal ansehen wie der planet dann daussieht in beewegeung!"
- Round 1, note filed under d-res, meant for the pause: "aber bitte, dass der planet nicht abrupt los geht wenn man wieder fokus gewinnt!."
- Round 1, note filed under d-breathe, meant for the stars: "die sterne die funkeln sollen immer random sein, es solll ein schönes detail sein!"
- Round 3, closing note: "Mit dem umsetzen dann nochmal performance tests am ende machen auch nach live sc haltung erneut performance tests machen!!! Außerdem auch den menüpunkt wechsel testen nebst side loading, es hakt an allen ekcen... aktuelll"
- Earlier audit, 2026-11-05: "Ich will die qualiätt, übergänge und animationen nicht minimieren / verschlechteern"

## Decisions (later rounds override earlier ones)

| Id | Round | Value |
|---|---|---|
| d-rate | 1 | no answer arrived, replaced by d-rate2 |
| d-pause | 1 | yes: pause without window focus |
| d-res | 1 | css: cap the buffer at CSS pixels |
| d-stars | 1 | few: only a few stars twinkle |
| d-breathe | 1 | yes: same look through opacity |
| d-moons | 1 | fifteen: 15 fps |
| d-rate2 | 2 | tick: 15 fps, lower only the tick (the user declined the recommended 5 fps) |
| d-resume | 2 | continue: carries on where it stood, soft start |
| d-spark | 2 | three: 3 at a time (the user declined the recommended 6) |
| d-pause-all | 3 | yes: without focus the whole scene pauses |

## Checklist

### Planet
- [ ] P1 The page tick runs at 15 Hz while idle, off a timer, not at display rate. Planet stays at 15 fps; trains follow the tick (15 fps), as measured and as stated on the plan round.
- [ ] P2 The planet still follows every frame while scrolling, resizing, during the entrance (`planet-in`, the anchor moves through CSS) and during the asteroid's shake. It never lags behind the page.
- [ ] P3 Without window focus the planet stops: no tick, no draw.
- [ ] P4 On focus it carries on where it stood, with no jump and a soft start of about 1.5 s. The turn gets its own clock offset. A new page visit still starts from the wall clock, so every visit shows another side.
- [ ] P5 The buffer is capped at CSS pixels (dpr 1), the halo is only computed where `cover < 1.0`, anisotropy max is 2. Both draw paths (worker and page fallback) get it.
- [ ] P6 Reduced motion keeps its draw-on-demand behaviour.

### Scene
- [ ] S1 `.detail .lights` animates only while the layer is visible (not on /verse, Codex or admin).
- [ ] S2 `.stars.near` stops animating as a whole layer.
- [ ] S3 3 small stars twinkle at the same time at new random spots, with random duration, peak and gap, look as `.d1-pl-spark` in `rounds/02.html`. One-shot animations, no repeating pattern. None under reduced motion.
- [ ] S4 `fb-breathe` (both uses in `fusion-bar.component.scss`) animates opacity of a pseudo-element holding the bright rim, not `box-shadow`. Same look at rest and at the peak; the focused state is unchanged.
- [ ] S5 Moons draw at 15 fps instead of 30, worker and page path.
- [ ] S6 Without window focus the whole scene pauses (sun, moons, sparkle, search field, other infinite CSS animations of the hub), and continues smoothly on focus.

### Checks the user asked for
- [ ] T1 Performance measured again at the end, before and after, in Edge on the real GPU, with longer windows; scrolling and the entrance included.
- [ ] T2 Performance measured again after going live.
- [ ] T3 Switching menu items (Verse, Codex, HQ) tested and measured, with side loading of the routes. "es hakt an allen ekcen" is the report: find what hitches, name it with numbers.
- [ ] T4 Typecheck, lint, build, Karma; specs for pause, resume, sparkle.
- [ ] T5 `docs/performance-plan.md` section 6: "Not taken, because pixels would change" is rewritten; new measurements recorded.

## Measurement baseline (today's build)

Renderer + GPU process, % of a core, 1920x1000, 179 Hz, RTX 2080 Super. Scripts in the session scratchpad (`page.cjs`, `isolate.cjs`, `variants.cjs`), recipe in project memory `sc-webgl-perf-measure-real-gpu`.

- Whole page about 216 (Chrome for Testing). Removing in order: wave 9, fb-breathe 48, fs-demo 8, sun 14, stars + lights 53, rest of CSS 0, planet 26, moons 26, remainder 33.
- Quiet page, Edge: base 36.5; planet today +29.4; tick 15 Hz +13.7; plus shader savings and 0.5x +14.7.
- Noise between runs: about 7. The two browsers are not directly comparable.

## Project rules that apply

Standalone, signals, OnPush; no `console.*` (`core/log.ts`); branch stays `claude/background-planet-perf-d4f26b`; visible browsers are Edge (`channel: 'msedge'`), headless preferred; specs must not open real tabs.
