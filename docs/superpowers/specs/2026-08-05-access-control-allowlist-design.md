# Access Control, Email Allowlist & View-as UI-Fidelity — Design

**Date:** 2026-08-05
**Branch:** `claude/view-roles-access-control-2b64fc`
**Status:** Approved for implementation

## Goal

Turn SC Companion from a public-shell app into a login-walled app for approved members only, add an admin-managed email allowlist so only pre-registered emails may sign in (first login → viewer), fix the "view as" role preview so the UI faithfully hides higher-role affordances, add a share link with PostHog UTM, and separate "Abmelden" from the "Ansehen als" menu group. Existing users keep their access.

## Context (current state)

- The app shell is deliberately **public** (#131). Many routes are ungated: `/news`, `/starscape`, `/codex/*`, `/hangar` (teaser), `/release-notes`, `/about`, `/legal/*`, `/tools/extension`. Data protection today relies on per-route guards + Postgres RLS, **not** a whole-app login wall.
- **Invite-only already exists**: `profiles.is_approved` (default false), `approvedGuard` (signs out unapproved → `/login?denied=invite`), `handle_new_user()` sets `is_approved = is_bootstrap OR is_invited` (`invited_at` stamped by Supabase `inviteUserByEmail`), an admin `invite-user` edge function, and an invite form in the admin "Benutzer" page. A backfill already approved all pre-existing users.
- **Role model**: `profiles.role ∈ {admin, collaborator, viewer}`. Role writes are locked to `set_user_role()` (SECURITY DEFINER) by triggers; founder accounts frozen via `protected_admins`.
- **"View as"** (`src/app/auth/impersonation*.ts`): client-side, downgrade-only, reload-on-toggle. `anon` preview is RLS-faithful (swaps to `anonClient`); `viewer`/`collaborator` previews demote only the role signals — **data still loads with real admin rights** (documented, accepted). The single security gate is `impersonationTargets()` in `impersonation-policy.ts` — **do not add elevation paths.**

## Decisions (from brainstorming)

1. **App-gate:** hard wall. Only `/login`, `/legal/privacy`, `/legal/imprint` are public (legal requirement), plus **`/about`** (login-card trust link, anti-AV-phishing). Everything else requires auth + approval.
2. **Allowlist:** combined model — an `allowed_emails` table is the source of truth; the admin action also optionally sends a Supabase invite email.
3. **View-as:** UI-fidelity only. The admin stays admin in the backend and can switch back anytime; the goal is that the **UI shows only what the selected role sees**. Keep the honest banner caveat ("data loads with real rights").
4. **Share:** button in the admin "Benutzer" area; copies a link to the public entry (`/login`) with UTM params; UTM captured in PostHog. No PII in the link.

## Non-goals (YAGNI)

- True data-level fidelity for `viewer`/`collaborator` view-as (would need server impersonation / shadow sessions — out of scope, security risk).
- Locking public game content (news/codex) behind RLS. The gate is a product/UX wall; public game data staying readable at the DB level is fine. RLS work is limited to ensuring **sensitive** data is not exposed to anon or unapproved-authenticated callers.
- Revoking already-signed-in users when their allowlist entry is removed (managed separately via the existing user table).

---

## Component design & contracts

### C1 — Menu cosmetics (frontend)
Add a divider (`<hr class="menu-sep">`, styled to match) before the **ABMELDEN** button in the profile dropdown (`src/app/shell/shell.component.ts`). "Ansehen als" and "Abmelden" become visually separate groups.

### C2 — View-as UI-leak fix (frontend + qa)
Audit **every** role-gated UI affordance and ensure it reads the **clamped** signals (`roles.role()` / `roles.isAdmin()` / `roles.isCollaborator()`), never `roles.realRole()`:
- Main sidebar nav, including the admin nav group (Benutzer / Telemetry / Feedback) and any collaborator-only entries (e.g. uploader).
- Profile dropdown items (`INTEGRATIONEN` etc.).
- FABs and page-level admin/collaborator actions.

Method: grep for `realRole`, `isAdmin`, `isCollaborator`, and role literals in `src/app/**`; confirm the nav-item list is computed from the clamped role signal. **Acceptance:** entering view-as `viewer` and `collaborator` shows no admin/collaborator-only items anywhere in the chrome; qa verifies via browser screenshots. `anon` view-as under the new gate correctly lands on the login wall (banner stays mounted in `AppComponent`, exit-preview reachable).

### C3 — Full app-gate, default-deny (frontend)
Restructure `src/app/app.routes.ts` to **fail closed**:
- Put `canActivateChild: [authGuard, approvedGuard]` on the shell parent route so **all** shell children require auth + approval by default; new routes are gated automatically. Existing role guards (`roleGuard(...)`) stay as additional constraints.
- Move the public pages into a **public layout** (bare chrome, no gated nav) that does not inherit the shell's gate:
  - `/login` (keep `publicOnlyGuard`), `/legal/privacy`, `/legal/imprint`, `/about`.
- `/desktop/connect` (top-level): add `approvedGuard` alongside `authGuard`.
- Wildcard `**` → `/news` stays (anon bounces to `/login` via the gate).
- Ensure the login card's trust links point only to public pages (`/about`, `/legal/privacy`, `/legal/imprint`).

**Acceptance:** logged-out visitor hitting any gated route → `/login`; the only reachable pages while signed out are login + the three public pages. RLS remains the real data barrier (the gate is UX).

### C4 — Email allowlist (core: DB)
New migration `supabase/migrations/20260805120000_email_allowlist.sql` (verified non-colliding against origin/main; re-check prefix at write time):

```sql
create table public.allowed_emails (
  email       citext primary key,
  role        text not null default 'viewer' check (role in ('admin','collaborator','viewer')),
  added_by    uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz            -- set on first matching signup
);
alter table public.allowed_emails enable row level security;
-- admin-only: select/insert/update/delete via is_admin(); service_role bypasses RLS.
-- NO anon / non-admin authenticated access (must not leak who is invited).
```

Extend `handle_new_user()` (keep bootstrap + invited logic, add allowlist; grandfather existing users — trigger fires only on INSERT):
- `is_approved = is_bootstrap OR is_invited OR exists(select 1 from allowed_emails a where a.email = new.email)`
- initial `role = coalesce((select a.role from allowed_emails a where a.email = new.email), <existing default>)` — i.e. pre-assigned role, else the existing viewer default. Bootstrap admin path unchanged.
- set `consumed_at = now()` on the matching `allowed_emails` row.

Admin RPCs (SECURITY DEFINER, `where is_admin()` or raise):
- `list_allowed_emails()` → `(email, role, note, created_at, consumed_at, joined boolean)`; `joined` = an `auth.users` row exists for that email.
- `remove_allowed_email(target_email citext)` → delete one entry.
- (Add is handled by the edge function below so it can also approve an existing user / send a mail in one call.)

Document the migration + the table in `.claude/deep-knowledge/supabase.md`.

### C5 — Register edge function (core)
Extend `supabase/functions/invite-user/index.ts` (keep the name to avoid route churn; label it "Registrieren" in the UI). Admin-gated (verify caller role from JWT). Body: `{ email: string, role: 'viewer'|'collaborator'|'admin', sendInvite: boolean }`. Steps:
1. Upsert `allowed_emails(email, role, added_by = caller)`.
2. If an `auth.users` row already exists for `email` → set `profiles.is_approved = true` + role (via `set_user_role` / service role), so previously-denied users become approved.
3. If `sendInvite` → `inviteUserByEmail(email)` (existing behavior, now optional).
Return a discriminated status: `allowlisted | approved_existing | invited` (+ `user_exists` where relevant). Re-validate role against the allowed enum server-side.

### C6 — Admin "Benutzer" allowlist UI (frontend)
In `src/app/admin/admin.component.ts`:
- Reframe the invite form as **"Registrieren"**: email + role select + optional "Invite-Mail senden" checkbox → calls `invite-user` with the new body.
- Add an **Allowlist** section: table from `list_allowed_emails()` (email, role, status = pending/joined, added, note) with a **remove** button (`remove_allowed_email`) and role display. Client-side search/sort consistent with the existing user table.
- Keep the existing user table + role/delete controls unchanged.
- All new strings localized in `public/i18n/{de,en}.json`.

> **Amended 2026-09-06 (feedback 5e2facd9).** The separate Allowlist section is
> gone. Every address that had signed in appeared twice — once as an allowlist
> row reading "joined", once as the account it had become. `list_allowed_emails()`
> is still the feed, but its rows are merged into the single people table and
> only while they are still **open** invitations (`joined = false` and no account
> on that address). Such a row carries an "Eingeladen" pill, how long the invite
> has been outstanding, and a **"Einladung zurückziehen"** button — the same
> `remove_allowed_email()` call the old "Entfernen" made. Consumed allowlist rows
> render as their account row only. No schema, RPC or RLS change.

### C7 — Share button + PostHog UTM (frontend)
- **Button** in the admin "Benutzer" area next to "Registrieren": copies `${location.origin}/login?utm_source=admin_share&utm_medium=referral&utm_campaign=access_invite` to clipboard (Clipboard API + fallback), shows a toast. It is a copy **action** → `<button>`. No PII in the link.
- **Capture** in `src/app/core/analytics.service.ts`: a one-shot `captureLanding()` run at app init that, only when `statistics` consent is granted, reads `utm_source/medium/campaign` from `location.search` and passes them as event properties (register once). The existing `pageviewUrl()` keeps stripping query/fragment from stored URLs, so UTM never persists in tracked page URLs.
- Localize button + toast strings.

### C8 — Security review (core + redteam)
- **RLS audit:** verify **sensitive** tables (profiles beyond self, hangar/loadouts, `allowed_emails`, admin data, protected_admins) deny anon and unapproved-authenticated callers via direct API — the client gate is UX only. Public game-content tables (news/codex) may stay readable; that is intended.
- `allowed_emails` is admin-only (no invite-list leak).
- No self-approval / self-promotion regression: allowlist writes are admin-only; `handle_new_user` is SECURITY DEFINER; direct `role`/`is_approved` writes stay blocked by existing triggers. Confirm the register function cannot be driven by a non-admin.
- Default-deny routing (fail closed); legal pages remain reachable (compliance).
- **redteam** adversarial pass: can the gate be bypassed to sensitive data? can `allowed_emails` leak? can view-as elevate? partial-failure in the register function (allowlist written but approval failed)?

---

## Implementation breakdown (devops agents)

| Agent | Scope | Files |
|---|---|---|
| **devops:core** | C4 migration, C5 edge function, C8 RLS audit/fixes, deep-knowledge doc | `supabase/migrations/`, `supabase/functions/invite-user/`, `.claude/deep-knowledge/supabase.md` |
| **devops:frontend** | C1, C2, C3, C6, C7, i18n | `src/app/app.routes.ts`, `src/app/shell/`, `src/app/admin/`, `src/app/core/analytics.service.ts`, public layout, `public/i18n/{de,en}.json` |
| **devops:redteam** | C8 adversarial review (read-only) | reads migrations, functions, guards, routes |
| **devops:qa** | build, typecheck, `npm test`, browser verification of C2/C3 | runs after core + frontend land |

**Sequencing:** core + frontend run in parallel (disjoint file trees), each commits its own work on the branch. redteam + qa run after both land. Contracts (C4/C5 signatures, C3 route structure) are fixed here so parallel work stays compatible.

**Operational guards:**
- Stay in the worktree; commit per agent so a git-sync/reset can't lose work.
- qa runs `npm install` first (worktree has no `node_modules`).
- Do not hand-deploy edge functions/migrations — CI deploys on merge (since PR #336). This branch only implements + verifies locally.

## Testing

- **Unit:** migration RLS (allowlist admin-only; unapproved authenticated denied on sensitive tables), `handle_new_user` allowlist branch, register edge function status matrix, existing impersonation specs still green.
- **Guard/routing:** logged-out → `/login` for gated routes; public pages reachable; `approvedGuard` unchanged behavior.
- **Browser (qa):** view-as viewer/collaborator → no admin items (screenshots); gate redirect; share button copies correct URL.
- **Regression:** existing users stay approved; founder protection intact; view-as no-elevation invariant.
