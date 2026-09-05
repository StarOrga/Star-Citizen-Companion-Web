# Decision — admin feedback panel interior rethink

Locked 2026-09-05 from the concept page
`docs/concepts/2026-09-04-feedback-panel-innenleben.html`, iteration 2,
action **implement** (submission `_version` 2, picked up 2026-09-04T22:05Z).
The decisions log is `docs/concepts/2026-09-04-feedback-panel-innenleben-decisions.json`.

## Chosen direction: Ⓔ "Board + Geliefert im Strom"

Ⓑ (ux-design) as the base, with Ⓐ's third band (Geliefert inside the same
scroll) and every point of the settled core (approaches.md § Settled core):

1. No Übersicht/Abarbeiten/Fortschritt tabs. One scroll in three bands ordered
   by whose turn: **Du bist dran** (admin) → **Läuft** (routine / user) →
   **Geliefert** (day feed, newest day first). The run view
   (`feedback-workflow.component`) is retired; its queue logic in
   `feedback.types` survives.
2. The first "your turn" card opens expanded with its inline action. Acting
   collapses it and the next one rises. One open at a time.
3. Status = position on the 4-station **flight path** (Eingang · In Arbeit ·
   Geliefert · Abgenommen) with Ⓑ's marker forms, back-loop arc and branch
   endcaps (Issue · Abgelehnt · Verworfen), **plus the baton in words**. All 11
   states stay distinguishable (codebase-facts § Data).
4. Geliefert as a day feed with `▸ Ansehen` deep link (area → route map),
   PR/issue link, and a "neu seit deinem letzten Blick" marker
   (`lastSeenShippedAt` in localStorage). Replaces the ship-cheer banner.
5. Fortschritt stays byte-identical, re-homed behind a 📊 glyph.
6. Controls at rest: **search field always visible + one Filter button** →
   full-height sheet (Wer? / Wo steht es? / Bereich), rows ≥ 48 px. Every
   chip row goes. Rare acts (issue order/undo, decline, delete, message the
   user) behind one ⋯ per card.
7. Composer bar pinned at the bottom.

### Round-1 feedback, applied (iteration 2)

- **Red only for elevated access and the one primary CTA.** Admin avatar red
  (`--sc-accent-hot`), primary send/answer button red; everything else
  `--sc-accent`. `--sc-danger` stays for errors/destructive.
- **Role-coloured avatars:** admin red, collaborator light blue, user
  grey-blue. A role field per author is needed in the board projection
  (`profiles.role` joined into the feedback view — a view column, no table
  migration). Label on the card distinguishes **Auftrag** (Claude
  instruction, admin-authored) from **Nutzer-Feedback**.
- **No duplication on the card:** no "DU" badge, no repeated status sentence,
  no "Routine" sender box.
- **A topic opens as a full-panel sheet**, not inline. Shows the poster's
  first message + the last message; between them "•••" with "1 weitere
  einblenden (n dazwischen)" that expands one more message per tap.
- **Big composer** in the sheet: tall text field, 72 px attachment
  thumbnails, "+" (attach), 📷 Screenshot of the current screen, send.

### Round-2 feedback, applied as implementation spec (no further mock round)

- **e-s2:** attachments on *sent* messages render as **small** thumbnails
  (clearly smaller than the 72 px composer previews) so they do not eat the
  sheet; the composer is **always at the bottom edge of the sheet** (sticky /
  floating if the thread is short or the keyboard is up); the "+" menu
  offers **both** "Datei anhängen" and "Screenshot" — the 📷 button is not the
  only way to add a screenshot.
- **e-s4:** **no Routine avatar / circle.** A topic initiated by the routine
  shows a plain text label **"AI"** without a circle. The initiator's role
  avatar (admin / collaborator / user) is the only circle on a card head.
  Intermediate messages in an opened thread may carry role icons; routine /
  AI replies (Rückfragen) are plain text with the "AI" label, no icon.
- **r2-max-same note:** maximised (same column, wider) may surface things the
  docked view hides — e.g. the between-messages of a thread, the full
  filter set inline, more of the shipped feed per day.
- **r2-viewer-link note:** "unbedingt!" — the `▸ Im App ansehen` deep link
  also on **shipped** topics, for admin, collaborator and viewer alike; at
  least for the main point the thread is about.
- The general note of this submission is a verbatim re-send of iteration 1
  (page defect, Jerry0022/dotclaude#333) — not new feedback.

### Round-3 feedback (chat, 2026-09-05, while implementing)

- **Sent messages longer than 3 lines fold the rest behind "…"** (expandable
  per message). Applies to every already-sent message in the stream and in the
  opened topic — the composer stays unfolded. Rationale: long messages eat the
  vertical space the panel does not have.

## Decisions (Ⓔ5)

| id | choice | meaning |
|---|---|---|
| r2-shot-display | include | 📷 via `getDisplayMedia` (browser picker, exact frame, panel hidden while grabbing); not on iOS → "+" only |
| r2-shot-dom | discard | no DOM-render fallback |
| r2-max-same | include | maximised = same column, wider |
| r2-max-split | discard | no master/detail |
| r2-role-field | include | role in the feedback projection (view column) |
| r2-viewer-link | include | **over corridor** — viewer panel: "Im App ansehen" on shipped topics + 📷 in the shared user composer |
| r2-options | include | **over corridor** — one-tap answer options: routine marks `[[A|B]]`, panel renders buttons; without markup nothing changes |
| r2-pr1..pr4 | include | 4-PR order below |

## Implementation order (4 PRs, value first)

1. **PR 1 · Strom + Bänder + Vollpanel-Thema + großer Composer (ohne 📷)** —
   tabs and run view out, flight path, first+last fold, role colours (with
   projection), red rule, "AI" label, sticky composer, small sent-thumbnails.
2. **PR 2 · Geliefert-Band nach Tagen + Badge + ▸ Ansehen + „neu seit"** —
   confetti banner out; area → route map; deep link on shipped rows.
3. **PR 3 · Suchfeld + Filter-Sheet (≥ 48 px), alle Chip-Reihen weg, ⋯ pro
   Thema** — toolbar demolition; mobile gate green.
4. **PR 4 · 📷 Screenshot + Ablehn-/Nutzer-Sheets + Telefon + i18n-Aufräumen**
   — polish; then the chosen over-corridor extras (viewer deep link, options)
   as decided in the corridor-widening question.

## Corridor

Brief corridor: panel interior completely; shell untouched; viewer panel
untouched unless an approach needs a small, justified change (flag it).
Two chosen extras exceed it (viewer panel; routine prompt convention) →
one explicit corridor-widening question before the autonomous handoff.
The answer is appended below when given.

## Corridor-widening answer

2026-09-05: **both extras in** (user answer "Beides rein"). The corridor is widened to (a) the viewer panel: "Im App ansehen" deep link on shipped topics + the screenshot button in the shared composer, and (b) the feedback-routine prompt + panel: the [[A|B]] one-tap answer-options convention. Both land in PR 4, after the core.

## Implemented

2026-09-05: direction E implemented on branch `claude/feedback-panel-ux-rethink-6459f0` (commits cbfb764 … 23d0d39, concept close-out d8235b0). Final report: docs/concepts/2026-09-04-feedback-panel-innenleben.html (Abschlussbericht tab). Not pushed — /ship is the admin's call after the signed-in walk-through.
