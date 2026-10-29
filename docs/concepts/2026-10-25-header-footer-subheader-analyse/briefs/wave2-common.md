# Wave 2 — common rules for every agent

Integration branch: `claude/star-citizen-header-footer-analysis-d7b33d` (contains Wave 1 foundation,
commit 57099f89). Before you start: `git fetch origin && git merge origin/claude/star-citizen-header-footer-analysis-d7b33d`
if `git log` does not contain 57099f89. Push your work to `claude/star-citizen-header-footer-analysis-d7b33d-<role>`
(role given in your prompt). Commit early (`wip(shell): …`), push early. Never push to the integration
branch or main, never deploy, never `db:push`.

Read first (absolute paths, read-only — they live in the session worktree, not yours):
- Spec: `C:/Users/Jerem/IdeaProjects/Star-Citizen-Companion-Web/.claude/worktrees/adoring-mirzakhani-2254f4/docs/concepts/2026-10-25-header-footer-subheader-analyse/briefs/implement.md`
- Wave 1 contract: `…/briefs/contract-w1.md` (LayoutService, PageLayout, tokens `--sc-space-1..8`, `--sc-bar-h`,
  `--sc-footer-h`, `--sc-gap-head`, `--sc-bar-hide-ms`, `.sc-frame` tracks, `BetaService.isEnabled('shell')`)
- Mock fragments: `…/docs/concepts/2026-10-25-header-footer-subheader-analyse/rounds/03.html`, `04.html`
  (design `fusion`, screens d4-s1…d4-s6), `05.html` (design `beschriftung`, d9-s1…d9-s4). Grep them for
  the screen you need; build with app tokens, never copy mock CSS prefixes.
- Project rules: root `CLAUDE.md` (real anchors, isPlainLeftClick, no native dialogs/tooltips/selects,
  i18n de+en, toErrorKey, core/log.ts, `--sc-accent-hot` only for elevated access, `--sc-warning` for worse
  comparison values, phones: nothing under the feedback launcher, `dvh`, One page frame).

Hard rules:
- Everything behind `BetaService.isEnabled('shell')`. Beta off = today's app, byte-for-byte behaviour.
- Ship detail Holotisch / Klassisch content block stays EXACTLY as it is (spec §10).
- File ownership is strict (your prompt lists yours). Need a change in someone else's file → do the
  smallest possible hook (one element / one input) and say so in your report; never restyle it.
- Phone (≤ 600px), tablet (768–1080) and desktop (≥1280, plus 2560) must all be designed, not just shrunk.
  `prefers-reduced-motion` → no slide/zoom, crossfade at most.
- Gates before you report: `npm run typecheck`, `npm run lint` (0 errors), `npm run build`, and the Karma
  specs you touched or added (run Karma in its own Bash call, never chained). If `node_modules` is missing:
  `npm ci` in your worktree.
- Report: branch + commits, exported API other agents use, deviations from the spec with the reason,
  what you did not verify.
