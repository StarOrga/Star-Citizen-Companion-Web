---
title: Support & feedback
excerpt: Where to report a bug, what to include, and how to reach the maintainers.
---

## In-app feedback

The fastest route for anything about the app itself is the **feedback button**
inside SC Companion. It lands directly in the maintainers' triage queue, and it
carries the context (route, version) automatically.

One message holds up to **2,000 characters** — the field counts down in its
bottom-right corner — plus up to ten screenshots. That is room for a detailed
report; if you genuinely need more, send a second message in the same thread.

## GitHub issues

For bugs, data errors, documentation mistakes and feature requests, open an
issue on the repository:

**<https://github.com/StarOrga/Star-Citizen-Companion-Web/issues>**

Useful details to include:

| For | Include |
|---|---|
| **Anything** | What you did, what happened, what you expected |
| **Web app** | The route (`/codex/…`), your browser, and the app version from the footer |
| **Public API** | The endpoint, the timestamp, the `error.code`, and `X-Patch-Version` from the response headers |
| **Codex data** | The class name (`AEGS_Gladius`), the patch/build shown on the Codex hero, and what the game actually shows |
| **Data Uploader** | The tool version, the channel (LIVE / PTU / EPTU), and the quality score of the bundle |

## Security

Please do **not** open a public issue for a security problem. The project
publishes an [RFC 9116 `security.txt`](https://sc-companion.vercel.app/.well-known/security.txt)
with the correct contact.

## Documentation drift

These guides are generated from markdown in the repository, so a documentation
fix is a normal pull request against
[`docs/readme-io/pages/`](https://github.com/StarOrga/Star-Citizen-Companion-Web/tree/main/docs/readme-io/pages).
Editing a page in the ReadMe web editor is not the way — the repository is the
source of truth and a sync overwrites remote edits.

If a guide and `GET /openapi.json` disagree, the spec is right and the guide is
the bug.
