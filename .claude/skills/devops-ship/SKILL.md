---
name: devops-ship
description: Project-specific overrides for /devops-ship in SC Companion.
---

# /devops-ship — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/devops-ship/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **Watch this repo's downstream deploy surfaces — they land after the merge.**
   `ship_release` only confirms PR merge + GitHub release/tag. The real
   artefacts arrive MINUTES later: the `data-uploader-build.yml` workflow
   (tag-push) gates a usable binary, and the Vercel web deploy runs on
   main-push. After `ship_release` succeeds with a tag that triggers external
   work, run `gh run watch <run-id> --exit-status` in the background before
   calling `render_completion_card`.

   The completion-card **variant** choice (merged ⇒ `ship-successful`;
   unverified downstream ⇒ a `userFinalTest` item, never a downgrade to the
   pre-ship `ready` variant) is owned by the **plugin base skill** — see
   `plugins/devops/skills/devops-ship/SKILL.md` Step 6. Do NOT re-encode it
   here; this project file only enumerates the project-specific surfaces
   (rule 2) to flag.

   *Why this rule exists:* in the 2026-05-24 Phase-2 ship, I rendered
   `ship-successful` immediately after `ship_release` returned ok. The
   `desktop-v0.3.0` tag-triggered Windows build then failed silently 2
   minutes later (numpy/Python compat) — the user had to ask "ist das
   schon durch, ist alles live?" to surface it. The Vercel deploy was
   never set up at all but my card didn't flag that either. The card
   IS the user's source of truth for "what worked"; rendering it
   prematurely makes me look done when I'm not.

2. **List every external deploy target in the completion card explicitly.**
   When the ship affects multiple deploy surfaces (web → Vercel, desktop →
   GH Release binary, edge functions → Supabase), enumerate ALL of them
   under `tests` or `userFinalTest` with their verification status —
   "Vercel: deployed ✓ / not deployed / pre-existing 404", "Binary build:
   green / red / pending", "Edge Functions: redeployed ✓". Don't hide an
   unverified-or-broken surface behind a global "shipped" headline.

3. **Tag-only retries: bump the tag, don't re-push the same one.**
   When the binary build fails and we need to retry after a fix, push a
   new patch tag (`data-uploader-v0.3.1`, then `.0.3.2`, …) — never delete +
   re-push the same tag. The GH-Action artefacts retention + release
   history rely on monotonic tags. The first failed tag stays as
   permanent record that "v0.3.0 binary never shipped, v0.3.1 was the
   actual first delivery".

4. **Monorepo subpackage version bumps: do them yourself.**
   `mcp__plugin_devops_dotclaude-ship__ship_version_bump` only updates the
   ROOT `package.json` (the one it auto-detects via `projectType: "npm"`).
   This repo has at least two version-baked-into-artefact `package.json`
   files: root (web app) AND `data-uploader/package.json` (electron-vite
   bakes `process.env.npm_package_version` into `__SC_TOOL_VERSION__`,
   which ends up in the Tool's update banner, OAuth headers, and the
   web's Data Uploader download page after admin-registration).

   **Required after `ship_version_bump` succeeds (root only):**
   - `grep -n '"version"' data-uploader/package.json data-uploader/package-lock.json`
     to confirm the subpackage version
   - If it doesn't match the new root version, bump it manually +
     run `npm install --package-lock-only` inside the subpackage to
     refresh the lockfile
   - Commit alongside the version-bump commit, never in a separate PR

   *Why this rule exists:* v0.3.0 / v0.3.1 / v0.3.2 all ended up with
   binaries reporting `0.1.3-dev` internally because the bump was missed.
   User had to surface this by checking the live page. Symptom: shipped
   tag number ≠ binary version constant ≠ DB-registered version. Three
   places to keep in sync, and the plugin tool only knows about one.

5. **Data-uploader ship ⇒ ALSO release the binary — not just a source bump.**
   When a ship touches `data-uploader/**`, completing the binary release is a
   **default part of the ship**, not a manual afterthought. Merging to `main`
   only bumps the source + runs typecheck/test; a source bump alone is invisible
   to users. So after the merge, unless the user says otherwise, DO the release:
   1. push the `data-uploader-v<binVersion>` tag (triggers CI build);
   2. let CI publish the private source release **and** the **full** public
      mirror (NOT a prerelease — else `/releases/latest` + the download page skip
      it);
   3. register the build in the catalog + point the **alpha** channel at it in
      one statement: `WITH new_rel AS (INSERT INTO public.desktop_releases
      (version, release_token, platforms, notes) VALUES (...) RETURNING id)
      INSERT INTO public.desktop_channels (product, channel, release_id) SELECT
      'uploader', 'alpha', id FROM new_rel ON CONFLICT (product, channel) DO
      UPDATE SET release_id = EXCLUDED.release_id, updated_at = now();`.
      `desktop_releases` is an immutable build catalog; `desktop_channels`
      (**keyed `(product, channel)`** since Starscape got its own rings —
      `ON CONFLICT (channel)` alone now errors) picks which build each ring serves. New releases default to the
      **alpha** ring; promotion to beta/stable is a deliberate later step via the
      `/admin/desktop-releases` panel or `promote_desktop_channel(version,
      channel)` — never auto-promote on ship. The CI "Print catalog-register SQL"
      step prints this ready CTE (URLs/sha512/sizes filled in); the
      `release_token` UUID comes from `gh run download -n release-token`.
      `/desktop` + the in-app updater resolve the release through the channel
      pointer (role-clamped: admin→alpha, collaborator→beta, viewer→stable) —
      without the row + alpha pointer the page stays on the old version.
   Then verify live in Edge (`/desktop` shows the new version + GitHub
   `/releases/latest` = the new tag).

   **Only deferral:** the catalog-register CTE needs Supabase **write**
   access. When it is genuinely unavailable in the session (Supabase MCP
   unauthenticated AND no linked `supabase` CLI), do steps 1–2, then **flag the
   binary loudly as "built + mirrored but NOT live"** and hand off the
   ready-to-run SQL (token already substituted). Never render a plain
   `ship-successful` while the row + alpha pointer are missing.
   `BINARIES_RELEASE_TOKEN` PAT must be ≤ 366 days (StarOrga org policy); if the
   CI mirror step fails, mirror the built assets via admin `gh` (no PAT). Full
   commands + the Supabase-auth blocker:
   `.claude/deep-knowledge/data-uploader-release.md`.

   *Why this rule exists:* 2026-06-13 I bumped the uploader to 0.7.0 and rendered
   `ship-successful` with no binary built → `/desktop` still served 0.6.1.
   2026-07-09 I shipped 0.13.0 source-only and stopped — the user had to say
   "release it too". Both times a source bump was mistaken for a release. Source
   bump ≠ release; for uploader ships the release rides along by default.

6. **Mobile + tablet gate — MANDATORY extra quality gate in Step 2.**
   Any ship whose diff touches `src/**`, `public/**` or `angular.json` must run
   the responsive gate **after** `ship_build` succeeded (the gate audits the
   freshly built `dist/sc-companion/browser`):

   ```bash
   npm run gate:mobile        # add --json=mobile-gate.json for an artefact
   ```

   - **Exit 1 ⇒ the ship is blocked.** Render `render_completion_card` with
     variant `ship-blocked` and quote the failing device/route lines. It is a
     quality gate exactly like build or lint — do not "note it and continue".
   - **Exit 2** means the gate could not run (no Chrome, no target). Fix the
     environment; treat a gate that cannot run as red, never as green.
   - Fix the findings in the app. Only if a finding is genuinely a false
     positive, add a narrow, justified entry to `scripts/mobile-gate.config.json`
     (`ignore.selectors` / `ignore.consolePatterns` + a `$waivers` entry naming
     the follow-up) — **never** lower `thresholds.minTapTargetPx` (44) or
     `thresholds.minFontSizePx` (12). Those are the platform minimums; moving
     them makes the gate lie.
   - Backend-only ships (docs, `supabase/**`, `data-uploader/**`, workflows)
     skip it automatically — nothing frontend changed.
   - Deliberate skip for a frontend ship: put `SKIP-MOBILE-GATE: <reason>` in
     the response, and list "mobile gate: skipped (<reason>)" under `tests` on
     the completion card. Never silent.
   - What each check means, how to run it against a preview URL, and the device
     matrix: [`docs/mobile-gate.md`](../../../docs/mobile-gate.md).

   *Why this rule exists:* admin feedback c21fab87 ("Mobile ist es einfach noch
   nicht gut") — phone/tablet quality was only ever verified by eyeballing a
   screenshot, so regressions (sideways scroll, 28 px chips, 10 px labels,
   sticky bars over buttons) shipped repeatedly. A ship-time gate is the last
   place where that can still be caught before users see it.
