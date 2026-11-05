# Implement brief: Freunde (Runde 1)

Generated from the submitted payload, never summarised. Decisions log: [../../2026-11-05-freunde-zweck-und-platz-decisions.json](../../2026-11-05-freunde-zweck-und-platz-decisions.json). Payload: [../payloads/01.json](../payloads/01.json). Round: [../rounds/01.html](../rounds/01.html) (option wording and consequences are binding).

## Verbatim answers

### Lesart: Rolle im HQ (`d-rolle`)
- Antwort: `"ok"`
- Notiz, wörtlich: keine

### Zweck von Freunden (`d-zweck`)
- Antwort: `"zusammen"`
- Notiz, wörtlich: „+ teilen + sozialbereich mit vergleichen usw....“

### Was Freunde zusätzlich können (`d-umfang`)
- Antwort: `["uebernehmen","einsatz","variante","zusagen","online"]` (weicht von der Empfehlung `uebernehmen einsatz` ab)
- Notiz, wörtlich: „Ja genau, ich stelle mir vor im Social Bereich , dort kann ich vergleichen wie sie scc web / app nutzen, aber auch was sie so machen ggü. mir, später dnan auszupfeilen mit gemeinsamen anspoprn usw. aber im hq an allen ecken und enden natürlich integriert, auch wenn sehr dezent oder nur in fällen.“

### Platz von Freunden (`d-heimat`)
- Antwort: `"konto"` (weicht von der Empfehlung `beides` ab)
- Notiz, wörtlich: „Lass usn doich eine seite soical machen auf meinen proifl icon menü - nix dazu in den einstellungen! Und ansonsten embeedeed in hq aber keine extra seite sondern einfach an den diversen stellen“

### Meldung offener Anfragen (`d-signal`)
- Antwort: `"zaehler"`
- Notiz, wörtlich: keine

### Link-Aufräumen (`d-links`)
- Antwort: `["sackgasse","geteilt","bestand","einstieg","suche","perk"]`
- Notiz, wörtlich: „Freunde dürfen auch in orgs organisiert werden und in einsatzgruppen bei mehreren!“

### Klick auf einen Freund (`d-name`)
- Antwort: `"freundseite"` (nicht angesehen, Vorauswahl)
- Notiz, wörtlich: keine

### Weg zur Freundschaft (`d-finden`)
- Antwort: `"einladung"`
- Notiz, wörtlich: keine

### Sichtbarkeit für Freunde (`d-sicht`)
- Antwort: `"hangar"` (weicht von der Empfehlung `aktiv` ab)
- Notiz, wörtlich: „ja man soll festlegen können pro freund und generell auf der social setite was man automatisch teilt! dort in den einestellungen als popup oder so..“

## Readings the orchestrator fixed (each is named in the final report)

- R1. `d-heimat`: the radio says `konto`, the note overrides it. One page `/social` reached from the profile-icon menu. `/friends` redirects to it. Nothing about friends in Settings. HQ gets NO extra page: embedded at the existing places, subtle, only when there is something to show.
- R2. Groups (`d-links` note): an owner-private list of friends with kind `org` or `einsatzgruppe`; one friend can be in several. Members do not see the list. It is the recipient picker for sharing. A real shared Org with its own membership is not this.
- R3. "später dann auszupfeilen mit gemeinsamen Ansporn": joint goals are explicitly later, not built now. Comparison is built now.
- R4. `d-sicht` = `hangar` "Deinen ganzen Hangar, abschaltbar": on by default, general setting plus per-friend override, in a popup on the Social page. Privacy page gets a paragraph.

## Checklist (one line per accepted item)

- [ ] C01 d-zweck: friends are co-players plus sharing plus a social area with comparison
- [ ] C02 d-umfang uebernehmen: adopt a friend-shared FPS set into own locker as a copy owned by the recipient
- [ ] C03 d-umfang einsatz: share an Einsatz with friends read-only, visible in HQ
- [ ] C04 d-umfang variante: share a ship variant directly with a friend
- [ ] C05 d-umfang zusagen: crew slots and RSVPs on a shared Einsatz
- [ ] C06 d-umfang online: show which friends are online
- [ ] C07 d-umfang note: Social page compares how friends use SCC web and app and what they do relative to me
- [ ] C08 d-heimat note: page `/social` in the profile-icon menu, `/friends` redirects
- [ ] C09 d-heimat note: nothing about friends in Settings
- [ ] C10 d-heimat + d-umfang notes: embedded in HQ at the existing places, subtle or only when relevant, no extra HQ page
- [ ] C11 d-signal zaehler: counter on the account menu plus a card on HQ Start, accept with one click in HQ
- [ ] C12 d-links sackgasse: "no friends" in the share panel links to the Social page
- [ ] C13 d-links geteilt: "Von Freunden geteilt" names the friend as a real anchor
- [ ] C14 d-links bestand: shared sets also appear in the HQ Bestand page
- [ ] C15 d-links einstieg: Settings card removed, profile menu is the entry
- [ ] C16 d-links suche: search keyword "org" no longer leads to friends (a keyword for the group feature is fine only if it leads to groups)
- [ ] C17 d-links perk: Kartograph text corrected, it is a public link
- [ ] C18 d-links note: friends can be organised in orgs and Einsatzgruppen, several per friend (R2)
- [ ] C19 d-name freundseite: friends-only page `/social/<name>` showing what you share, not visible to others; every friend name links there
- [ ] C20 d-finden einladung: personal expiring invite link, clicking creates the request; exact username stays possible
- [ ] C21 d-sicht hangar + note: friends see the hangar by default, switchable in general and per friend, in a popup on the Social page (R4)
- [ ] C22 Privacy page and readme-io/docs mention the new data sharing where they describe data use
