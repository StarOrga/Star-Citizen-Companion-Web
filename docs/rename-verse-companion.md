# Rename away from "Star Citizen Companion"

Why: "Star Citizen" is a registered trademark of Cloud Imperium Rights LLC
(EU, UK, US, CA, AU, WIPO; classes 9/41). CIG's Fankit and Fandom FAQ allow
fan sites, but not the mark in a product name or a site URL.

**The final name is not decided yet.** "Verse Companion" (the placeholder in
`src/brand.json`) collides with an existing German Star Citizen tool at
`verse-companion.vercel.app` and a Bible app at `versecompanion.app`. Do not
ship the placeholder. Whatever name is chosen: never file a trademark for it;
it is a working name for a non-commercial fan tool.

Subtitle everywhere: EN "<Name> – unofficial fan tool for Star Citizen",
DE "<Name> – inoffizielles Fan-Tool für Star Citizen". Title format: the
name as two words, followed by the alpha badge.

## Changing the name

```bash
node scripts/apply-brand.mjs "New Name"
```

`src/brand.json` is the single source. Components read it through
`src/app/core/brand.ts` (`BRAND_NAME`, `BRAND_INITIALS`); the script rewrites
every literal copy (i18n, `src/index.html`, manifest, browser extension,
README, readme.io pages, OpenAPI) and skips history (CHANGELOG, release notes,
concept mockups, migrations). `prebuild` runs `apply-brand.mjs --check`.
Afterwards run `npm run gen:readme-content` and the usual gates.

## Stage 1 — user-visible (this repo)

Name-independent and done: fan-site notice visible in the shell footer, the
login card (the public entry page) and About, each with a link to
robertsspaceindustries.com and the trademark line; About also shows CIG's
original English wording in non-English views. Extension store text is honest
(`browser-extension/STORE-LISTING.md`), README/LICENSE/humans.txt carry the
notice. The desktop app is called "Companion App" on the web. No donation,
ad or Patreon links exist.

## Steps that need the owner's accounts (once the name is final)

1. **Vercel project** `star-citizen-companion-website` → Settings → General →
   rename to `<name-slug>` (no domain purchase for now: the free
   `<name-slug>.vercel.app` becomes the primary URL — check first that it is
   not taken). Settings → Domains: **remove**
   `star-citizen-companion-website.vercel.app` (CIG domain rule); keep
   `sc-companion.vercel.app` as a redirect. The Vercel MCP has no delete for
   project domains and the CLI is not logged in, so this is a dashboard step.
2. **Allowlists** (code, then deploy): add the new origin to
   `supabase/functions/api/_cors.ts`, `supabase/functions/concept-page/index.ts`,
   `supabase/config.toml`, the extension's `host_permissions` and
   `scripts/lib/test-account.cjs` `deployHosts`.
3. **Supabase Auth** (project `hcnqhvzlavdycidqyaai`) → URL configuration:
   Site URL and redirect URLs for the new origin; edge-function secret
   `PUBLIC_SITE_URL`.
4. **Google OAuth** client: new authorized JavaScript origin, consent-screen
   app name. **Discord** developer portal: app name (the id stays).
5. **readme.io**: project name; subdomain `star-citizen-companion` → new slug
   (then update `docs/readme-io/*`, `.github/workflows/readme-docs-sync.yml`).
6. **Chrome Web Store**: paste `browser-extension/STORE-LISTING.md`. A new
   host permission makes Chrome disable the update until the user accepts —
   ship that as its own extension version.
7. **GitHub repos** (`gh repo rename`; GitHub keeps redirects): web, app,
   binaries. Binaries only after the desktop app ships an updater that follows
   redirects (app repo, `docs/architecture/rename-verse-companion-stage2.md`).
8. **Fan Kit** (downloaded by the owner): with the Fan Kit Agreement accepted,
   the "Made by the Community" badge may be used — the web footer already
   shows `public/icons/made-by-community.png`; swap in the Fan Kit's official
   file once its folder path is known.

## Stage 2 — technical identifiers (later, with migration)

Keep for now: localStorage keys `sc-companion.*`, extension bridge id
`sc-companion-extension`, User-Agent `SC-Companion/x`, package name
`sc-companion`, dist path `dist/sc-companion`, Supabase/R2 ids. Each needs a
read-both/write-new migration release before the old id can go.

## Compliance findings for the owner to decide

See the session notes (news audit, 3D audit). In short: news cards are within
the FAQ (title, date, ≤280-char excerpt, link); the patch-note outline mirrors
Spectrum patch notes almost line by line; RSI news images are re-hosted on R2
instead of hot-linked; the Starscape lightbox offers RSI wallpapers for
download and the Starscape desktop app saves them to disk; extracted hull
geometry, catalog tables and keybinds are publicly fetchable. Nothing was
deleted (owner decision).
