---
title: Quickstart
excerpt: Sign in, set your callsign, and find your way around the app in about two minutes.
---

## 1. Just look around — no account needed

Open <https://sc-companion.vercel.app>. **Verse News**, the **Codex**,
**Starscape** and the release notes are all public: you can browse them signed
out. Only the personal surfaces (Hangar, Settings, admin) require an account.

The app is a **PWA**: install it from your browser's address bar and it runs in
its own window, keeps a service-worker cache, and survives a flaky connection.

## 2. Sign in (optional, invite-only)

Registration is currently **invite-only** while the project is in alpha. If you
have an invite, you can sign in with e-mail or with Google OAuth — both land on
the same account when the address matches. SC Companion never asks for your RSI
credentials.

## 3. Pick a callsign

Once signed in, go to **Settings → Username**. A callsign is 3–20 characters,
lowercase `a–z`, digits and underscore. It is what the project shows instead of
your e-mail address.

**Settings** is also where you switch the interface language — the whole app
ships in English and German — and where you manage what the app is allowed to
keep in your browser's local storage.

## 4. Find your way around

| Where | What is there |
|---|---|
| **Verse News** | The default landing page. Filter by channel, star posts to keep them, and watch the RSI service status widget. Public. |
| **Codex** | The Bridge — a scanner search box plus lanes for your hangar, ships fresh in this patch, popular comparisons, and manufacturers. Public. |
| **Starscape** | The wallpaper gallery. Click a tile for full resolution, or grab the desktop app. Public. |
| **Hangar** | Your fleet. Add ships from the Codex, mark them owned or wishlist, and build named loadouts. Account required. |
| **Settings** | Callsign, language, storage consent, account deletion. Account required. |

## 5. Set a flagship

In the Codex or the Hangar, pin a ship as your **flagship**. It then opens at
the top of the Codex, gets a ★ in your hangar, and is stored on your profile —
so it follows you to every device you sign in on.

## 6. Optional — go further

- **Contribute data.** If you have collaborator or admin rights, the
  [Data Uploader](doc:desktop-tools) turns your local game install into a Codex
  update.
- **Build on the data.** The [Public API](doc:getting-started) is read-only and
  token-authenticated.
- **Decorate your desktop.** The [Starscape](doc:starscape) wallpaper app is a
  ~0.3 MB Windows tray app.

## Something looks wrong?

Use the feedback button inside the app, or open an issue — see
[Support](doc:support).
