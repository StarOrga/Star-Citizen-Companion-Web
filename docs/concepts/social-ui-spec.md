# Social: living spec

The next concept for friends or Social reads this first and continues it. Source: `2026-11-05-freunde-zweck-und-platz/` (rounds, verbatim brief, backend contract D1-D18) and `2026-11-05-freunde-zweck-und-platz-decisions.json`.

## Accepted

- Friends are co-players: sharing plus a social area with comparison.
- One page `/social` in the profile-icon menu, `/friends` redirects. Nothing about friends in Settings.
- HQ has no friends page. Friends are embedded at the existing places (Start, Planen, Jetzt, Bestand), subtle, and only when there is something to show.
- Open requests: counter on the account menu, card on HQ Start.
- Every friend name is a real anchor to the friends-only page `/social/<name>`.
- Personal invite link, a click files a request. The exact username stays possible.
- Friends see hangar, flagship, online status and comparison numbers by default, switchable in general and per friend in a popup on `/social`.
- Sharing: Einsätze read-only, ship variants, sets with adoption as a copy. Crew slots and RSVPs on a shared Einsatz.

## Rejected

- A separate HQ page for friends.
- A public profile. The friend page does not exist for anyone else.
- A search over all accounts.

## Assumed, not confirmed by the owner

- Orgs and Einsatzgruppen are owner-private lists of friends. A real shared group with its own membership is #903, which stays open.
- Ending a friendship removes shares, group memberships, overrides and RSVPs for good, also set shares. They do not return after a re-friend (D18).

## Open

- Shared goals between friends: #938.
- Website usage in the comparison: no per-account data exists.
- The planner of an Einsatz cannot answer or take a slot in the UI, although the server allows it.
