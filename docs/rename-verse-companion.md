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
  `sc-companion.vercel.app` keeps serving and stays in every allowlist.
- Supabase Auth: Site URL `https://versecompanion-alpha.vercel.app`, host
  added to the redirect allow list (Management API).
- Extension: honest store text (`browser-extension/STORE-LISTING.md`),
  version 0.1.2, new host in host permissions.

## Still needs the owner (dashboards)

1. **Vercel → Domains**: remove `star-citizen-companion-website.vercel.app`
   (CIG domain rule; the Vercel MCP has no delete for project domains). Once
   the new host has run a while, set `sc-companion.vercel.app` to redirect
   (308) to `versecompanion-alpha.vercel.app`.
2. **Supabase Auth allow list** contains `https://*.vercel.app/**` — any
   vercel.app site is an allowed redirect target. Replace it with the project's
   own preview pattern (`https://versecompanion-alpha-*.vercel.app/**`).
3. **Google OAuth consent screen / Discord app**: display name "Verse
   Companion".
4. **readme.io**: project name and subdomain `star-citizen-companion`.
5. **Chrome Web Store**: paste `browser-extension/STORE-LISTING.md`, upload
   0.1.2 (adds a host permission — Chrome asks users to re-approve).
6. **GitHub repos** (`gh repo rename`, GitHub keeps redirects): web, app,
   binaries — binaries only after the desktop updater follows redirects.
7. Edge-function secret `PUBLIC_SITE_URL`, if set, → new host.

## Stage 2 — technical identifiers (later, with migration)

Kept for now: localStorage keys `sc-companion.*`, extension bridge id
`sc-companion-extension`, User-Agent `SC-Companion/x`, package name
`sc-companion`, dist path `dist/sc-companion`, Supabase/R2 ids. Each needs a
read-both/write-new release before the old id can go.

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
