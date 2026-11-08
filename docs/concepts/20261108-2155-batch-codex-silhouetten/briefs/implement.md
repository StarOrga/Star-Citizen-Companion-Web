# Implement brief — batch codex list, ownership head, item silhouettes

Concept: `docs/concepts/20261108-2155-batch-codex-silhouetten.html` (round 1, baked: `rounds/01.html`)
Decisions: `docs/concepts/20261108-2155-batch-codex-silhouetten-decisions.json`
Notes (do-batch archive): `.claude/batch-2026-11-08T20-51-47-893Z.md`

## The user's notes, verbatim

- #1 "hier links das funktioneirt nicht! Und bitte ohne scrollen!"
  [Anhang-Datei] P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\batch-6215da\.claude\batch-assets\2026-11-08T20-42-47-831Z-1.webp
- #2 "Silhjouetten von kleineren komponenten oder sogar munition (also nicht schiffen) sind meistens nur langweilige quadrate oder striche. Bitte dort detaillierter rangehen! mehr die umrisse erfassen, natürlich nicht komplett detailetreu,k aber zumindest besser dargestellt! Passe den data uploader entsprecehdn ahjn"
  [Anhang-Datei] P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\batch-6215da\.claude\batch-assets\2026-11-08T20-45-16-109Z-1.png
  [Anhang-Datei] P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\batch-6215da\.claude\batch-assets\2026-11-08T20-45-16-109Z-2.png
- #3 "warum wird mir das im hangar angezeigt, obwohl das die version in codex ist, also nicht im hanger!"
  [Anhang-Datei] P:\Projects\Star-Citizen-Companion-Web\.claude\worktrees\batch-6215da\.claude\batch-assets\2026-11-08T20-47-33-949Z-1.webp
- #4 "check aktuelle verse web feedbaacks, funktioniert unser neuer abhol und ship mechanismus gut? Geht nix verloren? Ist der synchron ztu dem onlihne. Check intensiv die letzten 15 feedbacks!" (answered in chat; the findings below are what was chosen to fix)

Open every attachment with Read before changing the code it belongs to.

## Round 1 decisions (submitted with "implement")

No comments, notes, pins or attachments were added on the page.

| Decision | Chosen | Deviates | Untouched |
|---|---|---|---|
| d-new-source — Quelle für „neu im Patch“ | ingest — record at upload in which patch an entry first appears (+ changed in patch X); re-uploads no longer reset it; needs a migration | no | yes |
| d-empty — Liste ohne Neues | discover — show entries of the category to discover, title „Codex · 4.10.2“; never empty; click puts the entry on the holotable; the word „neu“ only for real new | no | no |
| d-noscroll — Liste ohne Scrollen | fixed — as many rows as fit the height, rest via „+ N weitere ↗“; no wheel any more, mouse wheel scrolls the page again; the entry on the table is always visible | no | no |
| d-own-head — „Im Hangar“ im Codex-Kopf | shown — always say what is shown: „⌂ 1× im Hangar · Gezeigt: Serie“; with variants „Serie“ becomes the select | no | yes |
| d-sil-fix — Silhouetten-Ansatz für Items | proxy + axis + **edges** — filter physics/proxy hulls; pick the view with the largest outline for items; ALSO draw inner edges as a second, finer line | **yes (edges added)** | no |
| d-watcher — Watcher-Nebenbefunde | gateerr + double + live | no | yes |

Untouched = the user did not dwell on it; it was still submitted with "implement", so build it as recommended and name it in the final report.

## Checklist (one line per accepted item)

B1a — core (Supabase)
- [ ] C1 New table + ingest step that records per class name and kind the patch it first appeared in, and per patch which class names changed. Re-upload of the same patch must not reset either. Existing rows are seeded as "baseline / unknown first patch" — never as "new in 4.10.2".
- [ ] C2 Read path (RPC or view) for the web: new + changed class names of the current build's patch per kind; the old two-build diff stays as fallback only when the table holds nothing for that patch.

B1b — frontend Codex landing (after B1a contract)
- [ ] F1 `codexNews` / `loadPool` read "new/changed in patch" from the B1a read path.
- [ ] F2 Category with nothing new: list shows entries of the category to discover; pane title „Codex · {patch}“ instead of „Codex · neu in {patch}“; „neu“/„aktualisiert“ tags only on real new/changed entries; a click puts the entry on the holotable (held), arrow/modified click opens the page.
- [ ] F3 No wheel: fixed list with as many rows as fit the pane's height, rest via „+ N weitere ↗“; mouse wheel no longer captured; the entry on the table always visible. Fit at 1280×720 AND 1920×1080, no scrolling inside the pane.

B2 — frontend Codex head
- [ ] H1 Owned ship: head shows „⌂ 1× im Hangar · Gezeigt: Serie“ even without saved variants; with variants „Serie“ is the select (existing compact `sc-codex-mode-switch`). Concept codex-kopf-besitz decisions stay (head carries hangar yes/no + variant, card „Dein Exemplar“ unchanged). Viewer surface: `--sc-accent`. All strings via i18n de+en.

B3 — data uploader silhouettes (python)
- [ ] S1 Proxy/physics/collision hull nodes are filtered before rasterising (prove on the real P4K with COOL_AEGS_S01_Bracer_SCItem: before = quad, after = real outline incl. pipe loops).
- [ ] S2 Items (not ships) pick the projection with the largest outline area (ammo shows its profile, not a stroke). Ships stay top-down nose-up.
- [ ] S3 Inner edges (feature/crease edges) emitted as a second, finer path in the same viewBox, as a new optional field; within the path-length budget.
- [ ] S4 Recipe bumped (silhouette@N+1) so the next upload recomputes; pytest green incl. new cases "box with proxy" and "elongated ammo body".

B3b — frontend silhouette render (after B3 contract)
- [ ] R1 Every web consumer of the silhouette draws the new inner-edge path as a thinner, quieter line when present; rows without it render exactly as today.

B4 — feedback watcher
- [ ] W1 Root cause of `gate error: exit null` (12× since 11-06; scripts/routine-watcher.mjs:416) found and the cause logged.
- [ ] W2 Double start like 11-06 15:24 (#266, runs a7aba95d / 767727d9) proven from the logs and prevented.
- [ ] W3 Board/DB distinguish "merged" from "live" (deployed to production); "shipped" means online.
- [ ] W4 (settled) `npm run watcher -- install` to refresh the stale prompt copy (promptInSync:false).
