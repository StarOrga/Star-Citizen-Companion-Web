# Rename: Star Citizen Companion → Verse Companion

Why: "Star Citizen" is a registered trademark of Cloud Imperium Rights LLC
(EU, UK, US, CA, AU, WIPO; classes 9/41). CIG's Fankit and Fandom FAQ allow
fan sites, but not the mark in a product name or a site URL. The name
"Verse Companion" is a working name for a non-commercial fan tool — do not
file a trademark for it (third parties hold "VERSE" marks in software classes).

Subtitle everywhere: EN "Verse Companion – unofficial fan tool for Star
Citizen", DE "Verse Companion – inoffizielles Fan-Tool für Star Citizen".

## Stage 1 — user-visible (this repo)

Done in code: app name, titles, meta/OG/JSON-LD, manifest, boot splash,
footer/login/About fan-site notice (visible, with link to
robertsspaceindustries.com and the trademark line), extension name and
honest store text (`browser-extension/STORE-LISTING.md`), README/LICENSE/
humans.txt, OpenAPI title, readme.io pages. The desktop app is called
"Companion App" on the web. CORS and auth redirect allowlists already accept
`verse-companion.app`, `www.verse-companion.app` and
`verse-companion.vercel.app`.

## Steps that need the owner's accounts (in this order)

1. **Register `verse-companion.app`** (and optionally `.com`) — e.g. in the
   Vercel dashboard → Domains → Buy. Both were available on 2026-11-08.
2. **Vercel project** `star-citizen-companion-website` → Settings → General →
   rename to `verse-companion`. Then Settings → Domains: add
   `verse-companion.app` (production) and `www.verse-companion.app` (redirect
   to apex); keep `sc-companion.vercel.app` (redirect 308 → new domain once
   everything below is done); **remove** `star-citizen-companion-website.vercel.app`
   (CIG domain rule).
3. **Supabase Auth** (project `hcnqhvzlavdycidqyaai`) → Authentication → URL
   configuration: Site URL `https://verse-companion.app`; add redirect URLs
   `https://verse-companion.app/**`; keep the `sc-companion.vercel.app` ones.
   Edge-function secret `PUBLIC_SITE_URL` → `https://verse-companion.app`.
4. **Google OAuth** client (Google Cloud console → APIs & Services →
   Credentials): add `https://verse-companion.app` as authorized JavaScript
   origin; rename the OAuth consent screen app name to "Verse Companion".
   **Discord** developer portal: app name "Verse Companion" (the application id
   stays).
5. **readme.io**: project name "Verse Companion"; subdomain
   `star-citizen-companion` → `verse-companion` (update links in
   `docs/readme-io/*` and `.github/workflows/readme-docs-sync.yml` afterwards).
6. **Chrome Web Store**: paste `browser-extension/STORE-LISTING.md`, upload
   0.1.2. When the new domain is live, the extension needs a new host
   permission (`https://verse-companion.app/*`) — Chrome disables an update
   that adds host permissions until the user accepts, so ship that as its own
   version.
7. **GitHub repos** (can be done by `gh repo rename`; GitHub keeps redirects):
   `Star-Citizen-Companion-Web` → `verse-companion-web`, `-App` →
   `verse-companion-app`, `-Binaries` → `verse-companion-binaries`. Do the
   Binaries rename only after the desktop app ships a version whose updater
   follows redirects (see the app repo's
   `docs/architecture/rename-verse-companion-stage2.md`).
8. **Fan Kit Agreement** (https://robertsspaceindustries.com/fankit, login):
   accept it before using the "Made by the Community" badge. The web footer
   already shows the badge — if the agreement was never accepted, remove the
   badge until it is.

## Stage 2 — technical identifiers (later, with migration)

Keep for now: localStorage keys `sc-companion.*`, extension bridge id
`sc-companion-extension`, User-Agent `SC-Companion/x`, package name
`sc-companion`, dist path `dist/sc-companion`, Supabase/R2 ids. Each needs a
read-both/write-new migration release before the old id can go.
