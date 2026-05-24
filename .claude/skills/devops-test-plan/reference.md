# devops-test-plan — SC Companion reference

Verbose snippets referenced from `SKILL.md`. Keep here so the SKILL.md itself
stays at 1–3 lines per rule.

## Live-Probe-Snippet

Run all 5 surfaces in **one** Bash call so output stays compact:

```bash
echo "=== Vercel ===" && curl -sI https://sc-companion.vercel.app | grep -E "^HTTP|^Content-Type|^Location" | head -3
echo "=== GH Release page (auth via gh) ===" && gh release view desktop-v$(gh release list --limit 1 --json tagName --jq '.[0].tagName' | sed 's/desktop-v//') --json name,assets --jq '{name, asset_count: (.assets | length)}'
echo "=== Edge Fn desktop-latest ===" && curl -s -w "\nHTTP %{http_code}\n" https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/desktop-latest
echo "=== Edge Fn ingest-bundle ===" && curl -s -X POST -w "\nHTTP %{http_code}\n" https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/ingest-bundle
echo "=== Edge Fn check-bundle ===" && curl -s -w "\nHTTP %{http_code}\n" "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/check-bundle?channel=live&patch=test&build=test"
```

**Expected results (healthy state):**

| Surface | OK | Means |
|---|---|---|
| Vercel | `HTTP/1.1 404` | "pending first deploy" per `deployment-status.md`. If anything else → update that file. |
| GH Release | JSON with `asset_count >= 1` | Tagged release exists, assets uploaded by `desktop-tool-build` workflow |
| Edge Fns | `{"error":"unauthorized"}` + `HTTP 401` | Function reachable, auth gating works as designed. 200 would mean gating is BROKEN; 5xx would mean function is down. |

Anything else = surface degraded. Report in the test summary, don't bury.

After probing, cross-check against `.claude/deep-knowledge/deployment-status.md`
and flag drift. That file is the source-of-truth for "what should be live".

## GitHub-auth-wall note

`curl https://github.com/Jerry0022/Star-Citizen-Companion-Website/releases/tag/desktop-v0.3.3`
returns `HTTP/1.1 404 Not Found`. The release EXISTS — GitHub returns 404
instead of 403 for private-repo URLs without an auth header. This is a
deliberate GitHub feature (avoids leaking the existence of private repos).

Workaround: always use `gh release view` / `gh release download` for github.com
URLs. `gh` injects the auth token from `gh auth login`. If raw `curl` MUST be
used (e.g. in a script that has its own GH_TOKEN), include
`Authorization: Bearer ${GH_TOKEN}` explicitly.

## Auto-update bug

The `desktop-latest` Edge Function returns a `latest.yml` whose `url:` and
`path:` point at the GitHub Release asset URL (e.g.
`https://github.com/Jerry0022/Star-Citizen-Companion-Website/releases/download/desktop-v0.3.3/sc-companion-setup-0.3.3-x64.exe`).

For end-users who aren't members of the (private) repo, that URL returns 404
when fetched without GH auth. electron-updater has no GH credentials baked in,
so **auto-update will fail at the download step** even though the update-check
succeeds (the Edge Function itself is reachable via the bundled release-token).

Open tracking issue: [#7](https://github.com/Jerry0022/Star-Citizen-Companion-Website/issues/7) (Auto-update download fails for end-users).

**Three viable fixes** (pick one before recommending the auto-updater to
real end-users):

1. **Make the repo public** — simplest. Loses the private-repo benefit
   (the WIP web app + non-shipping branches become world-readable).
2. **Mirror binaries to Supabase Storage** on a public bucket — the
   `desktop-latest` Edge Function rewrites the `url:` from
   `github.com/.../releases/download/...` to
   `supabase.co/storage/v1/object/public/...`. The asset upload step
   would happen in the GH-Actions workflow after `electron-builder`.
3. **Add a Supabase Edge proxy** that takes a release-token, fetches
   the GH asset using a service-stored `GITHUB_TOKEN`, streams the
   bytes back. Slowest (proxy is on Supabase egress), but no public
   exposure of the binary.

Until one of these lands, the auto-update flow is a known-broken surface —
include "auto-update download" in test reports as **❌ blocked by
private-repo asset access**, not "✓ should work".
