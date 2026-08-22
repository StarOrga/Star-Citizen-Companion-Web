# Decision — Verse News rethink

**Date:** 2026-08-20
**Decided on:** the concept page `docs/concepts/2026-08-20-verse-news-einstieg.html`, iteration 1
**Action submitted:** `implement`
**Verbatim comment:** „ich mag das erste konzept am liebsten!"

## Chosen approach

**Ⓐ — Bühne · Befund · Strom** (lens: product-value), the radical-subtraction
line: three objects on the page, the patch depth moved off it entirely.

Ⓑ (Sichtfenster & Instrumente) and Ⓒ (Seit du weg warst) were not chosen.
Neither was rejected on its merits — both stay readable on the frozen
iteration-1 tab of the concept page, and two of their ideas are worth
revisiting later:

- Ⓑ's **release train** (Evocati · PTU · Live · Nächster as one 64 px strip) is
  a better picture of the pipeline than the verdict card's sentence, and it
  would fit the patch board without touching the landing page at all.
- Ⓒ's **read-line** ("N neu seit deinem letzten Besuch" plus a caught-up
  divider) is the only one of the three that makes a catch-up day finite. It
  needs a persisted last-visit timestamp in the consent-gated preference store
  plus a defined degraded mode when consent is declined — which is why it is a
  bigger bite than it looks.

## What shipped under this decision

See the concept page's "Abschlussbericht" tab for the full file list, the test
evidence and the four open items. In short:

- `pickStage` replaces "first item of the Today bucket" — the hero can no
  longer be absent, which was the original defect (measured 2026-08-20: the
  bucket did not exist, so no hero rendered at all).
- The verdict card reduces the patch apparatus above the fold to one sentence
  plus its basis (median + sample count, never dropped).
- `/news/patches` carries the rotating carousel, both filter axes and the full
  history — 2,019 px that used to sit above the first news article.
- `groupWaves` folds a run of same-version, same-facet notes into one row
  (measured: 20 rows / 1,215 px for the open 4.10 line).

## Not implemented

The `implement` action covered the design only. It did **not** commit, push or
ship — the branch `claude/verse-news-design-concept-5f215c` carries the change
uncommitted, and shipping stays an explicit user decision.

Visual verification against a signed-in session is also outstanding: `/news` is
behind `authGuard` and no local session exists without the Supabase-stack detour
documented in `.claude/deep-knowledge/local-dev.md`. Structure is covered by DOM
assertions in the specs; appearance is not.
