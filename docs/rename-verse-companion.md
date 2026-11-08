# Rename: Star Citizen Companion → Verse Companion

Why: "Star Citizen" is a registered trademark of Cloud Imperium Rights LLC
(EU, UK, US, CA, AU, WIPO; classes 9/41). CIG's Fankit and Fandom FAQ allow
fan sites, but not the mark in a product name or a site URL.

"Verse Companion" is a working name for a non-commercial fan tool — never
file a trademark for it (third parties hold "VERSE" marks in software
classes). Known namesakes: a private, login-gated German Star Citizen tool at
`verse-companion.vercel.app` and a Bible app at `versecompanion.app`.

Subtitle everywhere: EN "Verse Companion – unofficial fan tool for Star
Citizen", DE "Verse Companion – inoffizielles Fan-Tool für Star Citizen".
Title format: the name as two words, followed by the alpha badge.

## Single sources

`src/brand.json` holds the name (`name`), the public host (`host`) and the
hosts that keep serving (`legacyHosts`). Components read `BRAND_NAME`,
`BRAND_INITIALS` and `BRAND_HOST` from `src/app/core/brand.ts`.

```bash
node scripts/apply-brand.mjs "New Name"          # rename every literal copy
node scripts/apply-brand.mjs --host new.host     # move canonical links/docs
node scripts/apply-brand.mjs --check             # runs in prebuild
```

History (CHANGELOG, release notes, concept mockups, migrations) is never
rewritten. Origin allowlists list the host AND every legacy host and are
edited by hand: `supabase/functions/api/_cors.ts`,
`supabase/functions/concept-page/index.ts`, `supabase/config.toml`,
`browser-extension/manifest.json`, `scripts/lib/test-account.cjs`.
After a change run `npm run gen:readme-content` and the usual gates.

## Done (2026-11-08)

- Name, titles, meta/OG/JSON-LD, manifest, boot splash, readme.io pages,
  OpenAPI title; desktop app called "Companion App" on the web.
- Fan-site notice (CIG wording + DE translation), link to
  robertsspaceindustries.com and the Fan Kit trademark notice, visible at
  ≥ 10 pt in the shell footer, the login card (the public entry page) and
  About. The official Fan Kit "Made By The Community" logo (white, only
  downscaled, no effects) replaces the old badge file.
- Public host `versecompanion-alpha.vercel.app` (free subdomain, no purchase):
  added to the Vercel project, project renamed to `versecompanion-alpha`,
  canonical/sitemap/robots/security.txt/docs point there.
  The old hosts `sc-companion.vercel.app` and `star-citizen-companion-website.vercel.app` were removed by the owner the same day (no redirects); every link, the extension, Starscape and the Data Uploader point to the new host.
- Supabase Auth: Site URL `https://versecompanion-alpha.vercel.app`, host
  added to the redirect allow list (Management API).
- Extension: honest store text (`browser-extension/STORE-LISTING.md`),
  version 0.1.2, new host in host permissions (0.1.4 follows in stage 2: new bridge ids).

## Still needs the owner (dashboards)

1. ~~Vercel → Domains~~: done 2026-11-08 (both old hosts removed).
2. **Supabase Auth allow list** contains `https://*.vercel.app/**` — any
   vercel.app site is an allowed redirect target. Replace it with the project's
   own preview pattern (`https://versecompanion-alpha-*.vercel.app/**`).
3. **Google OAuth consent screen / Discord app**: display name "Verse
   Companion".
4. **readme.io**: project name and subdomain `star-citizen-companion`.
5. **Chrome Web Store**: nothing to do — the extension is not listed there; it ships as a ZIP
   via the Binaries release `browser-extension-latest` (CI). `STORE-LISTING.md` is only for a
   future store listing.
6. **GitHub repos** (`gh repo rename`, GitHub keeps redirects): web, app,
   binaries — binaries only after the desktop updater follows redirects.
7. Edge-function secret `PUBLIC_SITE_URL`, if set, → new host.

## Stage 2 — technical identifiers (done, with migration)

Done:

- **localStorage `sc-companion.*` → `verse-companion.*`** (hangar recents, upcoming-ships
  favorites/baseline, news bookmarks, the consent purge list). One helper,
  `src/app/core/storage-keys.ts`: a read takes the new key, else the legacy one; a legacy hit is
  copied to the new key and the old key removed; writes only go to the new key. The consent purge
  clears both names. Remove the legacy fallback after a few months.
- **Extension bridge** `sc-companion-extension` → `verse-companion-extension` (app side
  `verse-companion-app`, presence attribute `data-verse-companion-extension`). The web accepts both
  extension ids and both attributes. It sends the legacy app id unless the extension announced
  version ≥ 0.1.4, because 0.1.0–0.1.3 only understand the old one. Extension 0.1.4 accepts both app
  ids, sends the new extension id and sets both attributes. Drop the legacy ids once 0.1.3 is no
  longer supported.
- **User-Agent** `SC-Companion/x` → `VerseCompanion/x` in every edge function (same `(+suffix)`
  shape, host suffix where there was none).
- **Package / build output**: `package.json` and `angular.json` project `verse-companion`, build
  output `dist/verse-companion/browser`, with every consumer (vercel.json, build/stamp/CSP/mobile
  gate scripts, CI, docs).
- **OG image** carries the Fan Kit "Made by the Community" logo (unaltered, in the corner).

Kept on purpose:

- **`sc.*` localStorage/sessionStorage keys** (`sc.auth`, `sc.lang`, `sc.consent`, ...): a short
  app-wide prefix, not the product name. `sc.auth` is the Supabase session; renaming it signs
  everyone out. No user-visible gain for roughly sixty keys.
- **URL scheme `star-citizen-companion://`**: installed desktop apps ≤ v0.104 register only that.
  The website switches to `verse-companion://` once the desktop release registering both is the
  oldest supported one (see `docs/contracts/scc-app-launch.md`).
- Supabase project id/refs and `project_id` in `supabase/config.toml`, storage bucket names, R2
  bucket and worker names (`sc-companion-assets`), `data-uploader/` package and app ids (separate
  product, installed apps), migration file names, CHANGELOG and release notes (history).
- readme.io subdomain (issue #1017) and GitHub repo slugs incl. the mirror `sc-companion-readme-docs`
  (issue #1020).
- Local-only handles: the Windows Credential Manager entry `sc-companion/test-account` and the
  local Supabase stack id.

## Compliance findings for the owner to decide (nothing deleted)

- News cards: title, date, ≤ 280-char excerpt of the original text, link —
  close to the FAQ, but the excerpt is CIG's words, not an own summary.
- Patch-note outline (`rsi-roadmap`) mirrors Spectrum patch notes almost line
  by line.
- RSI news images are downloaded, re-encoded and served from R2 instead of
  hot-linked.
- Starscape: the lightbox offers RSI wallpapers for download; the Starscape
  desktop app saves original-resolution RSI art to disk.
- Extracted hull geometry (textures stripped), catalog tables and keybinds are
  publicly fetchable (assets worker without auth, anon SELECT); keybinds have
  a JSON download button.
