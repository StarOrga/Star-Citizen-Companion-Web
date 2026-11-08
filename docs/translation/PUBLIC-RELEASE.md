# Final public release plan — translation sources

Decided in the concept `docs/concepts/20261108-1130-spieluebersetzung-community-seed.html`
(round-1 `d-license-note`, round-2 `d2-license-note`, `d-nopack-note`). Contract:
[ARCHITECTURE.md](ARCHITECTURE.md), operations: [OPERATIONS.md](OPERATIONS.md).

**Rule.** As long as the SCC app is only shown to friends, nothing is sent. Before the app is promoted beyond
people we know, every maintainer whose pack we use is informed, each in the form their licence calls for.
Everything below is **drafts only**: no code path sends a message, approval is reserved to **protected
admins** (`public.protected_admins`), sending is manual (copy the text, then mark it as sent) and **never
automatic**. Credit is always given in the same form for every source (see ARCHITECTURE.md § Licences and credit).
Drafts may be prepared now (`op: draft_outreach`, Admin → Translations → Anfragen); sending happens at the public release.

## Who is informed how

| Maintainer / source | Language | Licence | Channel (confirm at send time) | Kind of message |
|---|---|---|---|---|
| rjcncpt (`rjcncpt/StarCitizen-Deutsch-INI`) | de | CC-BY-NC-SA-4.0 | GitHub issue or discussion in the repo | notify: what we use, coverage, credit line, overlay under CC-BY-NC-SA 4.0, app stays free |
| Dymerz (`Dymerz/StarCitizen-Localization`, italian) | it | MIT | GitHub issue in the repo | notify (one draft per language source) |
| Dymerz (same repo, portuguese_brazil) | pt-BR | MIT | GitHub issue in the repo | notify |
| stdblue (`stdblue/StarCitizenJapaneseResources`) | ja | MIT | GitHub issue in the repo | notify |
| n1ghter (`n1ghter/StarCitizenRu`) | ru | CC-BY-NC-SA-4.0 (+ permission for CIG only) | GitHub issue in the repo | notify; the pack lives in the `korean_(south_korea)` slot, say so |
| circuspes (traduction.circuspes.fr, used via Dymerz) | fr | none ("Copyright © Traduction communautaire francophone de StarCitizen 2026") | contact form / Discord of the community project | **permission request** — no use until granted |
| 42kit (`ini.42kit.com`; also `StarCitizenToolBox/LocalizationData`) | zh-Hans | none | GitHub issue (ToolBox) / site contact | **permission request** — no use until granted |
| Thord82 (`Thord82/Star_citizen_ES`) | es | all rights reserved (`COPYRIGHT.md`: personal use only; redistribution or incorporation needs express prior permission) | GitHub issue in the repo | **permission request** — his `COPYRIGHT.md` requires express prior permission, so he **must be asked** before any use |

Message language is the maintainer's (de, it, pt-BR, ja, ru, fr, zh, es; English otherwise).
`notify` drafts state what we use (coverage, key count), how we credit (the exact line) and that we remove
the text on request; `permission` drafts ask for permission and say the text is not used until it is granted.

## Still missing — must be caught up

- **Korean** and **Polish** have no usable pack yet. Both need a source search (and, if found, the same
  licence check and outreach) before the public release is announced for them. Until then they show only CIG.
- fr, zh-Hans and es stay at CIG only until the permission is recorded (`granted` → source `permitted`).
  A `refused` answer disables the source for good.

## Checklist for the release day

1. For every source in the table: review its draft (statistics are refreshed by the last `import_seed`).
2. A protected admin approves each draft.
3. Send manually through the channel above, mark as sent, log the answer (`granted` / `refused` for permission requests).
4. Answers that change anything (different credit, objection) are handled before the promotion goes out.
