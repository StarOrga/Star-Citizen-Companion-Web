---
name: ship
description: Project-specific overrides for /ship in SC Companion.
---

# /ship — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/ship/`.
Plugin defaults still apply; only the rules below override or add.
(Rules 2–6 were merged in from the legacy `.claude/skills/devops-ship/`
extension when the plugin dropped the `devops-` skill prefix; the numbering
below is canonical — external docs cite it.)

## Project rules

1. **Mobile + tablet gate — MANDATORY extra quality gate in Step 2.**
   Any ship whose diff touches `src/**`, `public/**` or `angular.json` must run
   the responsive gate **after** `ship_build` succeeded (it audits the freshly
   built `dist/sc-companion/browser`):

   ```bash
   npm run gate:mobile        # add --json=mobile-gate.json for an artefact
   ```

   It emulates iPhone 14 (390×844), Pixel 7 (393×851), iPad Air (820×1180) and
   Galaxy Tab S9 (800×1280) over the public routes and asserts: no horizontal
   overflow, tap targets ≥ 44 px, text ≥ 12 px, no clipped or overlapping
   content, no sticky/fixed element covering a control, a zoomable viewport
   meta, and no console errors on the mobile viewport.

   - **Exit 1 ⇒ ship blocked** — `render_completion_card` variant
     `ship-blocked`, quoting the failing device/route lines.
   - **Exit 2 ⇒ the gate could not run** (no Chrome, no target). That counts as
     red, never as green. Only an environment that provably has no Chromium may
     re-run with `npm run gate:mobile -- --skip-if-unavailable`; that exits `0`
     with a `SKIPPED` line, which must then be reported as a skip (not a pass)
     exactly like `SKIP-MOBILE-GATE` below.
   - Never lower `thresholds.minTapTargetPx` (44) or `minFontSizePx` (12) to get
     green. False positives get a narrow `ignore` entry plus a `$waivers` note
     in `scripts/mobile-gate.config.json`.
   - Backend-only ships skip it automatically (nothing frontend changed). A
     deliberate skip on a frontend ship needs `SKIP-MOBILE-GATE: <reason>` in
     the response **and** a `tests` line on the completion card.

   Full documentation: [`docs/mobile-gate.md`](../../../docs/mobile-gate.md).

   *Why this rule exists:* admin feedback c21fab87 ("Mobile ist es einfach noch
   nicht gut") — phone/tablet quality had only ever been eyeballed, so
   regressions shipped repeatedly. This is the last point where they can still
   be caught before users see them.

2. **Watch this repo's downstream deploy surfaces — they land after the merge.**
   `ship_release` only confirms PR merge + GitHub release/tag. The real
   artefacts arrive MINUTES later: the `data-uploader-build.yml` workflow
   (tag-push) gates a usable binary, the `edge-functions-deploy.yml` workflow
   (main-push) pushes changed Supabase functions, and the Vercel web deploy runs
   on main-push. The plugin automates part of this — Step 4b spawns the
   post-merge watcher for the main-push CI run, Step 4c verifies declared live
   surfaces, Step 4d gates out-of-band deploys — but **tag-triggered builds sit
   outside the merge watcher**: after pushing a `*-v*` tag, run
   `gh run watch <run-id> --exit-status` in the background before calling
   `render_completion_card`.

   The completion-card **variant** choice (merged ⇒ `ship-successful`;
   unverified downstream ⇒ a `userFinalTest` item, never a downgrade to the
   pre-ship `ready` variant) is owned by the **plugin base skill** — see the
   plugin's `skills/ship/SKILL.md` Step 6. Do NOT re-encode it here; this
   project file only enumerates the project-specific surfaces (rule 3) to flag.

   *Why this rule exists:* in the 2026-05-24 Phase-2 ship, I rendered
   `ship-successful` immediately after `ship_release` returned ok. The
   `desktop-v0.3.0` tag-triggered Windows build then failed silently 2
   minutes later (numpy/Python compat) — the user had to ask "ist das
   schon durch, ist alles live?" to surface it. The Vercel deploy was
   never set up at all but my card didn't flag that either. The card
   IS the user's source of truth for "what worked"; rendering it
   prematurely makes me look done when I'm not.

3. **List every external deploy target in the completion card explicitly.**
   When the ship affects multiple deploy surfaces (web → Vercel, desktop →
   GH Release binary, edge functions → Supabase), enumerate ALL of them
   under `tests` or `userFinalTest` with their verification status —
   "Vercel: deployed ✓ / not deployed / pre-existing 404", "Binary build:
   green / red / pending", "Edge Functions: redeployed ✓". Don't hide an
   unverified-or-broken surface behind a global "shipped" headline.

   **Edge functions deploy themselves now — verify the run, don't claim the
   deploy.** `.github/workflows/edge-functions-deploy.yml` fires on every
   main-push touching `supabase/functions/**` or `supabase/config.toml` and
   pushes exactly the functions that changed
   (`scripts/changed-edge-functions.mjs` decides). So the card line is the
   *run's* verdict — `gh run list --workflow=edge-functions -L 1` — not "I
   deployed it". Two things still need a human:
   - The job **fails loudly** if the `SUPABASE_ACCESS_TOKEN` secret is missing.
     That is deliberate; fix the secret, never the check.
   - To redeploy without a code change (a stale function, a rolled-back
     deploy), use the manual trigger:
     `gh workflow run edge-functions -f functions=<slug|all>`.

   *Why this rule exists:* 2026-07-31 — PR #309 hardened `starscape-summary`
   and was merged on 07-29; nobody ran the deploy. Prod served the pre-#309
   code until a comm-link shipped a 7680×3292 image, then returned `546 Memory
   limit exceeded` on every request and Starscape's weekly wallpaper was gone
   for two days. Repo green, every local test green, production broken. Rule 3
   already asked for an "Edge Functions" card line — nothing enforced it, so
   the workflow enforces it now.

4. **Tag-only retries: bump the tag, don't re-push the same one.**
   When the binary build fails and we need to retry after a fix, push a
   new patch tag (`data-uploader-v0.3.1`, then `.0.3.2`, …) — never delete +
   re-push the same tag. The GH-Action artefacts retention + release
   history rely on monotonic tags. The first failed tag stays as
   permanent record that "v0.3.0 binary never shipped, v0.3.1 was the
   actual first delivery".

5. **Monorepo subpackage version bumps: do them yourself.**
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

6. **Data-uploader ship ⇒ ALSO release the binary — not just a source bump.**
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

   **Do not stall this on a confirmation.** The Data Uploader is a
   collaborator/admin tool — it is not a public download, and `/desktop`
   role-clamps the rings anyway (admin→alpha, collaborator→beta,
   viewer→stable). A new build lands on **alpha**, and alpha is alpha: the
   people who receive it are the same people who asked for the change. So the
   tag push and the catalog-register CTE are ordinary ship steps, not
   outward-facing publishing that needs sign-off. Treat "this reaches real
   users" caution as belonging to *stable* promotion, which is a separate,
   deliberate act via `/admin/desktop-releases` or
   `promote_desktop_channel(version, channel)`.

   The monotonic-tag rule (never delete + re-push a tag, §4) is about keeping
   the release history honest, not a reason to hesitate before tagging — a
   failed build is answered with the next patch tag, which is cheap.

   *Why this rule exists:* 2026-06-13 I bumped the uploader to 0.7.0 and rendered
   `ship-successful` with no binary built → `/desktop` still served 0.6.1.
   2026-07-09 I shipped 0.13.0 source-only and stopped — the user had to say
   "release it too". Both times a source bump was mistaken for a release. Source
   bump ≠ release; for uploader ships the release rides along by default.
