# sc-assets — R2 read Worker

Public read path for the Cloudflare R2 bucket `sc-companion-assets`. Today it
serves the ship hulls and livery icons (`ship-skins/<ship>/<skin>.glb|webp`).
Why R2 behind a Worker, and what else is planned there, is in
[`.claude/deep-knowledge/storage.md`](../../.claude/deep-knowledge/storage.md).

- `GET`/`HEAD` only, and only for the exact key shape ingest-skins writes.
  Everything else is a 404/405.
- A key R2 does not hold yet is streamed from the Supabase `ship-skins` bucket,
  so the site can switch to this host before the bulk copy.
- The Free plan stops the Worker at 100k requests/day (error 1027, no bill).
  That is the read-side cost guard for R2, which has no spending cap of its own.

## One-time setup

1. **Cloudflare account** with R2 enabled (needs a payment method). Set a
   **budget alert at $1** under Billing → Budget alerts.
2. **Bucket:** R2 → Create bucket `sc-companion-assets`, location *Europe (EU
   jurisdiction)*. Leave public access and `r2.dev` **off**.
3. **API token:** R2 → Manage API tokens → *Object Read & Write*, restricted to
   that bucket only. Note the Access Key ID, the Secret Access Key and the
   account ID.
4. **Edge-Function secrets** (Supabase dashboard → Edge Functions → Secrets, or
   `supabase secrets set`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`. Optional: `R2_BUCKET` (default
   `sc-companion-assets`), `R2_QUOTA_BYTES` (default 8 GB). From then on
   ingest-skins signs R2 uploads instead of Supabase ones.
5. **Deploy the Worker** from this directory:

   ```bash
   npx wrangler@4 login
   ```

   ```bash
   npx wrangler@4 deploy
   ```

   It prints `https://sc-assets.<subdomain>.workers.dev`.
6. **Switch the site:** set `assets.r2BaseUrl` in
   `src/environments/environment*.ts` to that URL, and add the host to
   `connect-src` and `img-src` in `vercel.json`'s CSP. Ship it.
7. **Bulk copy** the existing hulls. Run it from the repo root, with the three
   `R2_*` variables in the environment:

   ```bash
   npm run r2:migrate-skins -- --dry-run
   ```

   Then run it once more without `--dry-run`. Once the live site loads hulls
   through the Worker, add `--delete-source` together with
   `SUPABASE_SERVICE_ROLE_KEY` to free the Supabase storage.

## Test

```bash
npm run test:assets-worker
```
