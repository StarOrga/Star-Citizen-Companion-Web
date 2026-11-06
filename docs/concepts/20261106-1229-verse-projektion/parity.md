# Parity checklist: Verse projection

Source of every line: `rounds/03.html`, design `langsam`, unless another round is named.

| # | Item | Spec |
|---|------|------|
| 1 | Sequence in one go | Glow, cone shoots out, scan line runs down and builds the panel, runs up and writes the text, goes out at the top, cone pulls back into the planet |
| 2 | Approach timing (`d8-run`, 12 s) | Glow 840 ms, then shot 1560 ms with `cubic-bezier(.7,0,.84,0)` |
| 3 | Build | Scan line down 900 ms with `cubic-bezier(.45,.05,.3,1)`, turn 180 ms; the glass reveals exactly behind the line |
| 4 | Write | Scan line up 1320 ms with `cubic-bezier(.35,0,.45,1)`; text revealed bottom to top behind the line. No typing (round 1 a3) |
| 5 | Pull-back | Line out 144 ms, pull 1560 ms with `cubic-bezier(.7,0,.84,0)`, cone fades 300 ms |
| 6 | Cone fits the panel | Far end of the cone = scan line width at its current height, including the perspective widening (`sc = 1 / (1 - .103 s)`) |
| 7 | Cone look (round 3) | No hard lines, no dust (round 1 a1); two blurred layers; fill .015 at the planet, .05 at 14 cqw, .13 at 28 cqw, .25 at 40 cqw, .17 at 62 cqw |
| 8 | Waves | Soft radial waves, period 15 cqw, peak .11, 2.6 s, from the sender to the panel (round 1 a1) |
| 9 | Scan line (round 2 pin) | Band 2.6 cqw high: transparent, .16 at 40 %, white 49 to 51 %, .16 at 60 %, transparent; full strength for the whole sweep, lights up only as the cone lands |
| 10 | Panel | Dark glass with bright top hairline, faint bottom hairline, side hairlines with soft inner glow (round 1 a2) |
| 11 | From the right (round 3 pin) | Galerie sends a single cone, never a crossed double cone |
| 12 | Sender glow | Sender's atmosphere glows while the projection runs (`0 0 .32 s`) |
| 13 | Real page (round 1 a2) | Runs on `/verse` over the real planet simulation and the real small planets |
| 14 | Unchanged | Fixed panel size, "more" cue always visible, holo stays a real anchor, pointer or focus holds the relay, reduced motion shows the message without cone |
