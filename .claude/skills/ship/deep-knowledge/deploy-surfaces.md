# Ship: deploy surfaces and migrations (rule 10)

The procedure behind rule 10 in `../SKILL.md`.

After the merge, the ship itself brings every surface the diff touches live,
in dependency order:
- **Migrations** (`supabase/migrations/*.sql` in the diff): fast-forward the
  primary checkout to the merged `main`, then from there
  `npx supabase db push --remote --dry-run`, check that it lists exactly the
  new files, then `npm run db:push` (= `supabase db push --remote --yes`).
  Supabase CLI v3 targets the LOCAL stack without `--remote` and refuses a
  hosted change without `--yes` when no TTY is attached. Run it from the
  primary checkout because worktrees are not linked (see the migration-ledger
  memory). Confirm with `list_migrations`.
  **A migration that drops or renames something the live frontend still reads
  waits for production.** Before pushing it, read the merge commit's Vercel
  status (`gh api repos/<repo>/commits/<sha>/status`). "Deployment rate limited"
  means no production deploy comes on its own: bring the merge SHA live first
  (`create_deployment` with target production, the limit is a rolling 24 h
  window, so a slot frees when the oldest deployment ages out; without the
  Vercel MCP, the web guide from rule 12 / `vercel-rate-limit.md`), wait until the
  Production deployment for that SHA reports success, then push. Additive
  migrations keep the order above, because the new frontend needs them.
  A diff with both kinds splits them into two PRs: additive with the code, the
  drop in a later ship. *Why:* #972 pushed a `DROP TABLE` while production was
  rate limited, so the live site ran about 10 minutes against a missing table.
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
