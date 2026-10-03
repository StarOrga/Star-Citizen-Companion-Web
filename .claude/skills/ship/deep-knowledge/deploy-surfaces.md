# Ship: deploy surfaces and migrations (rule 10)

The procedure behind rule 10 in `../SKILL.md`.

After the merge, the ship itself brings every surface the diff touches live,
in dependency order:
- **Migrations** (`supabase/migrations/*.sql` in the diff): fast-forward the
  primary checkout to the merged `main`, then from there
  `npx supabase db push --dry-run`, check that it lists exactly the new files,
  then `npx supabase db push`. Run it from the primary checkout because
  worktrees are not linked (see the migration-ledger memory). Confirm with
  `list_migrations`.
- **Assets worker** (`cloudflare/assets-worker/**`):
  `npx wrangler deploy` in that folder, then probe one route.
- **Edge functions**: CI deploys them (rule 3). Wait for the run and use its
  verdict. If a function must be live before a later step, wait for the run
  first.
- **Post-deploy scripts** the PR names (backfills, R2 copy scripts): run them
  once their prerequisites are live. Dry run first, then the real run, then
  verify the result with a query or probe.
- **Uploader binary**: rule 6.

Stop only for three things. A login Claude cannot do (`wrangler login` is
interactive OAuth): ask in one line, then continue. A missing secret: ask in
one line, then continue. A migration that destroys data the user has not
approved in this session (DROP or DELETE of live rows): ask first. Everything
else runs without asking.

*Why it was manual until now:* the plugin treats deploys as outward-facing
and asks before them by default. Agent prompts carried "never deploy, never
db push". The migration-ledger hazards from worktrees made `db push` look
risky. Together these turned every deploy into a step list on the
completion card. The owner decided on 2026-10-03 that in this repo the ship
does these steps itself.
