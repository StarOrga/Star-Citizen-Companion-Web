---
title: Accounts & data
excerpt: Invite-only sign-up, what is public without an account, what is stored about you, and how to delete it.
---

SC Companion is deliberately small on data. This page summarises what an
account gets you and what the project keeps. The binding version is the
[privacy policy](https://sc-companion.vercel.app/legal/privacy) in the app.

## Public vs. account-only

| Surface | Signed out | Signed in |
|---|---|---|
| Verse News, Starscape, Codex, release notes | ✅ full read access | ✅ |
| Saved posts, news filters | — | ✅ |
| Hangar, configurations, role loadouts, flagship | — | ✅ |
| Settings (callsign, language) | — | ✅ |
| Data Uploader downloads, Bundle History | — | collaborator / admin |
| Admin: users, API tokens, telemetry, feedback | — | admin |

## Sign-up

Registration is **invite-only** during the alpha. Two sign-in methods lead to
the same account when the e-mail matches:

- **E-mail + password** — the password is stored only as a salted hash.
- **Google OAuth** — Google learns that you signed in here, and the project
  receives your e-mail address. Nothing else.

SC Companion never asks for your RSI account credentials and has no way to act
on your RSI account.

## What is stored

| Data | Where | Who can read it |
|---|---|---|
| E-mail, password hash | Supabase Auth, `eu-central-1` (Frankfurt) | you + admins |
| Profile (callsign, role, flagship) | Postgres, row-level security | you |
| Hangar, configurations, loadouts, notes | Postgres, row-level security | you |
| Session token, language, UI state | your browser's local storage | you |
| Anonymous product analytics | PostHog, EU servers | maintainers, aggregated |

Row-level security is enforced in the database, not just in the UI — another
signed-in user cannot read your hangar even by calling the API directly.

## Cookies and local storage

The app sets **no cookies at all**. Everything lives in your browser's local
storage, split into three buckets you control in **Settings**:

- **Essential** — session, language, and the consent decision itself. Always
  on; the app cannot work without them.
- **Preferences** — news channel filter, saved articles, similar convenience
  state. Turning it off deletes the stored values.
- **Statistics** — anonymous usage statistics (PostHog, EU). **Off by default**,
  no identification, no session recording.

As an installable PWA, a service worker also caches static assets on your
device. That cache holds no personal data.

## Alpha-phase data policy

While the phase flag is `alpha`, the project reserves the right to **rewrite
the schema and drop legacy tables** — everything except authentication users
and profiles. In practice that means hangar contents, loadouts and ingested
catalog data can be reset by a migration. Migrations that drop data document it
in a comment in the repository.

Treat anything you build in the Hangar today as replaceable until the phase
flips to `beta`.

## Deleting your account

**Settings → Delete account** removes the account and everything attached to it
— profile, hangar, configurations, uploads and bundles. It is immediate,
irreversible, and signs you out afterwards.

## Reporting a privacy or security issue

Security contact details are published as an
[RFC 9116 `security.txt`](https://sc-companion.vercel.app/.well-known/security.txt).
For anything non-sensitive, see [Support](doc:support).
