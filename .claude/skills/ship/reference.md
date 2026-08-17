# /ship — SC Companion delivery reference

Declarative config read by the devops ship pipeline (plugin `skills/ship/SKILL.md`
Step 0 → captured, Step 4b → headless post-merge watcher, Step 4c → live browser
check; format spec: plugin `skills/ship/deep-knowledge/post-merge-verify.md`).
Delivery itself stays the default `git+gh` — no `deliver:` key on purpose.

## Version marker

The served page carries `<meta name="app-version" content="vX.Y.Z">`, stamped
into the built `index.html` by `scripts/stamp-index-version.mjs` (postbuild —
also re-hashes `/index.html` in `ngsw.json`, see the script header). The value
is `v`-prefixed so containment checks pass whether `$VERSION` expands to the
bare semver (`ship_version_bump.vNew`) or the tag form. It lives in the
`content` **attribute** (meta tags have no textContent) — read it with
`document.querySelector('meta[name="app-version"]')?.content`.

Dev serves (`ng serve`) show `content="dev"` — only built artifacts carry a
real version.

## Surfaces + post-merge verify

Keep `verify:` inside the FIRST ```yaml fence of this file — the post-merge
watcher parses only that fence.

```yaml
surfaces:
  - name: "Web app (Vercel)"
    url: https://sc-companion.vercel.app/?ngsw-bypass=true
    selector: 'meta[name="app-version"]'
    attribute: content
    expected: "$VERSION"

verify:
  mode: http
  url: https://sc-companion.vercel.app/?ngsw-bypass=true
  expected_status: 200
  selector: '<meta name="app-version" content="([^"]+)"'
  expected: "$VERSION"
  poll_interval_seconds: 20
  timeout_seconds: 900
```

Notes:

- **`?ngsw-bypass=true` is mandatory for any browser-based check** — the Angular
  service worker replays the cached shell (old bytes AND old response headers)
  to returning visitors, which makes a freshly shipped version look stale. The
  watcher's Node-side fetch has no service worker; the param is harmless there
  and keeps every probe on the cache-busted path.
- Vercel deploys on main-push (typically 1–3 min) and the watcher only starts
  probing after CI on the merge commit went green, so `timeout_seconds: 900`
  is generous headroom, not expected wait.
- This marker covers the **web app only**. Starscape/data-uploader versions are
  DB-driven (`desktop_releases`/`desktop_channels`); uploader ships follow
  rule 6 of the project ship SKILL extension instead.
