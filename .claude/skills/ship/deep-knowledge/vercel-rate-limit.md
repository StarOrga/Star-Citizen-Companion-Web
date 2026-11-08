# Ship: Vercel deploy limit reached (rule 12)

The procedure behind rule 12 in `../SKILL.md`.

The Hobby plan caps deployments at 100 per rolling 24 h, previews included.
Once the cap is hit, a merge to `main` creates no production deployment, and
nothing looks broken: the site keeps answering 200, previews may still turn
Ready, and `ship_run` can report green checks.

## Detect

Read the merge commit's Vercel status before the card calls the web app live:

- `gh api repos/<repo>/commits/<sha>/status` reads "Deployment rate limited";
- `gh pr checks <n>` says "retry in 24 hours";
- a check link carries `upgradeToPro=build-rate-limit`.

## 1. Deploy it yourself first

`create_deployment` on the Vercel MCP, slug `jeremytreder-6210s-projects`,
target production, GitHub source with ref `main` and the merge SHA (team
access via `authorize_team_access` first). If it goes through, verify as
usual (rule 3); the card needs no guide.

## 2. Otherwise: guide item on the card

When that fails (the Vercel MCP is not authorized, team access is not
approved, or the call is still refused for the limit), the card stays
`ship-successful`, because the merge happened.

- `tests` gets "Vercel: rate limited, production on vX.Y.Z", with the version
  production really serves (`meta[name="app-version"]`).
- `open` gets exactly one guide item, so the card shows "Web-Guide starten":

```json
{ "text": "Production hängt auf vX.Y.Z – Vercel-Limit erreicht, manuell deployen (Slot frei ab HH:MM)",
  "guide": "web", "service": "Vercel Dashboard",
  "reply": "Führ mich durch den manuellen Production-Deploy von <merge-sha> im Vercel-Dashboard." }
```

Drop "(Slot frei ab …)" only when the deployment list could not be read.
Never write the click path into `open` or `userFinalTest` as text: the guide
walks it.

## 3. What the guide walks

auto-guide, in the user's Edge:

1. Open `https://vercel.com/jeremytreder-6210s-projects/versecompanion-alpha`.
2. Project menu (`…`, top right) → **Create Deployment**.
3. Enter the merge SHA as the commit reference and create it. A commit on
   the production branch becomes a Production deployment. Not the branch
   name `main`: if main has moved on, that deploys a different commit than
   the one the card names.
4. Done when that deployment shows **Ready** and `meta[name="app-version"]`
   on `https://versecompanion-alpha.vercel.app/?ngsw-bypass=true` shows the
   new version.

**Not** "Redeploy" on the newest production entry: that rebuilds the old
commit.

## The manual deploy counts against the same limit

It only goes through once a slot is free. The window rolls: a slot frees when
the oldest deployment of the last 24 h turns 24 h old. That time is the "Slot
frei ab" on the card, read from `list_deployments` (with `since`) or the
dashboard's deployment list. A refusal before that time is expected, not a
fault in the guide. On 2026-11-06 a slot was free about 45 min after the
rate-limit status, so the "24 hours" in the status overstates the wait.

## Destructive migrations wait

A migration that drops or renames something the live frontend reads waits
until the manual deploy is live (`deploy-surfaces.md`). Hand the guide over
before pushing it, not after.

*Why:* the limit was hit three times (2026-09-05, 2026-11-06 twice). Each time
the card named the production lag, but the way out, a deploy from the
dashboard, was left to the user as a description. The Vercel MCP is often not
authorized in a session, and Claude cannot click through the dashboard. The
guide turns that dead end into one button.
