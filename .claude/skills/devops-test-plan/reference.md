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

## Auto-update download probe

Since 2026-05-24 (issue [#7](https://github.com/Jerry0022/Star-Citizen-Companion-Website/issues/7)
resolution), binaries are mirrored to the **public** repo
[`Jerry0022/sc-companion-binaries`](https://github.com/Jerry0022/sc-companion-binaries).
The `desktop-latest` Edge Function returns YAML pointing at that public mirror's
URLs, so `electron-updater` can fetch without GitHub auth.

After every `desktop-v*` release, probe the asset URL UNAUTHENTICATED to
verify end-users can actually download:

```bash
TAG=desktop-v$(gh release list --limit 1 --json tagName --jq '.[0].tagName' | sed 's/desktop-v//')
VERSION=$(echo "$TAG" | sed 's/^desktop-v//')
curl -sIL "https://github.com/Jerry0022/sc-companion-binaries/releases/download/$TAG/sc-companion-setup-$VERSION-x64.exe" \
  | grep -E "^HTTP|^Content-Length" | head -4
```

**Expected:** `HTTP/1.1 302 Found` then `HTTP/1.1 200 OK` with
`Content-Length: ~132000000` (~126 MB installer).

If 404: either the mirror release wasn't published (check
`gh release list --repo Jerry0022/sc-companion-binaries` — the tag MUST
match the source repo's `desktop-v*` tag), or the
`secrets.BINARIES_RELEASE_TOKEN` PAT in the source repo's Actions
secrets is missing/expired. See
`.claude/deep-knowledge/deployment-status.md` § Asset hosting for the
PAT-setup playbook.
