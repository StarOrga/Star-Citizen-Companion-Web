# Changelog

All notable changes to SC Companion are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-05-17

### Added

- Initial Angular 21 PWA scaffold (standalone components, signals, OnPush, lazy routes).
- Supabase backend (`hcnqhvzlavdycidqyaai`, `eu-central-1`):
  - `profiles` table with auto-creation trigger on `auth.users` insert.
  - `p4k_uploads` table with channel/version enums and per-user RLS.
  - Storage bucket `p4k-uploads` with auth-scoped policies.
  - Edge functions: `fetch-verse-news` (Comm-Link + RSI status proxy), `process-p4k` (header heuristic + ZIP entry estimate).
- Auth flow: email/password + Google OAuth (PKCE), `authGuard` + `publicOnlyGuard`.
- Verse News feature: live Comm-Link feed via Star-Citizen-Wiki API proxy + RSI status RSS.
- P4K Analyzer feature: drag-drop upload, regex-based channel detection (live/ptu/eptu/tech-preview), upload history.
- i18n via ngx-translate v17 (en + de).
- Service Worker + manifest.
- Strict CSP, security headers, SPA rewrites in `vercel.json`.
- Claude-Code-fit: `CLAUDE.md` (root + `.claude/`), `deep-knowledge/` for Supabase, Verse-News, P4K-Format, `.mcp.json` with Supabase MCP.

### Notes

- Alpha phase: schema rewrites may drop legacy tables except `auth.users` and `profiles`.
- Vercel auto-deploys `main` once the project is connected.
- P4K parsing currently heuristic (first 64 KB scan). Phase 2 will add central-directory parsing and Manifest.xml extraction.

[Unreleased]: https://github.com/Jerry0022/Star-Citizen-Companion-Website/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Jerry0022/Star-Citizen-Companion-Website/releases/tag/v0.1.0
