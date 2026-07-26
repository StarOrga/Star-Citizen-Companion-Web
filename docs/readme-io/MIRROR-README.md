<!--
  This file is copied to the ROOT of the ReadMe Git-Sync mirror repository as
  its README.md by .github/workflows/readme-docs-sync.yml. It exists so that
  someone who lands in the mirror repo learns not to edit it there.

  It is NOT a ReadMe page — it lives at the repo root, outside docs/, so Git
  Sync ignores it.
-->

# SC Companion — ReadMe documentation mirror

**Do not edit this repository.** Every file here is overwritten on the next
sync.

This repo exists for one reason: ReadMe's Git Sync can only watch the **root**
of a dedicated repository, so the documentation authored inside the main
project is mirrored here for ReadMe to consume.

| | |
|---|---|
| **Source of truth** | [`docs/readme-io/pages/`](https://github.com/StarOrga/Star-Citizen-Companion-Web/tree/main/docs/readme-io/pages) in `StarOrga/Star-Citizen-Companion-Web` |
| **Published at** | <https://star-citizen-companion.readme.io> |
| **Mirrored by** | `.github/workflows/readme-docs-sync.yml` on every push to `main` |
| **Setup guide** | [`docs/readme-io/GIT-SYNC-SETUP.md`](https://github.com/StarOrga/Star-Citizen-Companion-Web/blob/main/docs/readme-io/GIT-SYNC-SETUP.md) |

## To change a page

Open a pull request against the **main repository**, not this one. CI validates
the tree against ReadMe's Git-Sync contract before it can merge; once it is on
`main`, the mirror and then the live site follow automatically.

Edits made in the ReadMe web editor commit back into this repo and are then
overwritten by the next mirror run. Same for edits made here directly.
