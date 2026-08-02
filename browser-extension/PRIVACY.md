# Privacy notice — SC Companion Hangar Import

Short version: the extension reads **personalised game content only** — the
ship names shown on your own RSI hangar page — and nothing ever leaves your
browser without you clicking confirm.

## What is read

- The ship names listed on `robertsspaceindustries.com/…/account/pledges`, and
  the title of the pledge each ship came from (so you can recognise the row).

## What is never read

- Credentials, passwords, cookies, session tokens, 2FA data.
- Your account name, handle, e-mail address, address, payment data.
- Pledge values, order numbers, purchase dates, store credit.
- Any page other than your RSI hangar page and Star Citizen Companion.

## Where the data goes

Nowhere, until you say so. The extension has **no server of its own** and makes
no request to any host except robertsspaceindustries.com — and only for the
further pages of your own hangar list, exactly like clicking "next page".

When you click *Import*, the ship list is written to the browser's local
extension storage and a Star Citizen Companion tab is opened. That tab reads
the list from the extension, shows you every entry, and only writes the ships
you confirmed — using the Supabase session you are already signed in with. The
extension itself never authenticates anywhere and holds no token.

## What is stored

| Key | Content | Lifetime |
| --- | --- | --- |
| `lastScan` | Checksum of your fleet + number of ships | Overwritten every 15 min |
| `nudgeState` | Checksum of the last import + time, dismissed checksums | Until you clear it |
| `pendingImport` | The ship list awaiting confirmation | Deleted after confirm/cancel, expires after 30 min |

All of it lives in `chrome.storage.local` on your machine. "Forget stored data"
in the extension popup deletes all of it.

## Permissions and why

| Permission | Why |
| --- | --- |
| `storage` | Remember the fleet checksum so the import is not offered when nothing changed |
| `robertsspaceindustries.com/…/account/pledges*` | Read the ship list on your own hangar page |
| `sc-companion.vercel.app` | Hand the list to the Companion tab |

No `tabs`, no `scripting`, no `<all_urls>`, no analytics, no remote code.

Star Citizen Companion is an unofficial fan project and is not affiliated with
the Cloud Imperium group of companies.
