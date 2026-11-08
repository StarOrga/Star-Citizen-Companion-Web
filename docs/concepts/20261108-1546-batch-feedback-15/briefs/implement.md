# Implement brief — batch feedback (15 notes), concept 20261108-1546-batch-feedback-15

Decisions file: `docs/concepts/20261108-1546-batch-feedback-15-decisions.json` (written at close-out; the baked rounds below are the source of truth).
Original notes (verbatim, with attachments): `.claude/batch-2026-11-08T14-43-27-113Z.md` (archived batch file in this worktree).
Binding mock spec for the Verse landing: `docs/concepts/20261108-1546-batch-feedback-15/rounds/02.html` (scene, label behaviour, blink/drift) and `rounds/03.html` design `r3-olisar` (the station SVG, screens `r3-d1-s1` Start, `r3-d1-s2` Hover HQ, `r3-d1-s3` Alles ruhig). Generator scripts: `C:\Users\Jeremy\AppData\Local\Temp\claude\3dca57aff47b9a99\aa5e4e9c-ae2b-47fe-ba3d-ef57e5fab8db\scratchpad\gen-r2.js`, `gen-r3.js`.

## The user's words, verbatim, per round

### Original notes (batch)
- #1 „Warum wird mir beim startt de ssc data uploader nicht angezeigt, dass es ein update gibt, obwohl ich weiß das es seins gibt und außerdem oben erechts ich sogar nochmal manuell refresh geklickt habe“
- #2 „im data uploader links unten steht performance, das klingt so wie performance mnodus, aber eigentlich steht die wichtige info daneben, nämlich volle leistung. Lass uns doch das wort perofrmacnce weg machen, der tempom at simbolisiert das shcon und einfach daneben im font style von dem alten performance dann den modus beschreiben !?“
- #3 „das können wir aus dem holotoisch raus nehmen, dafür haben wir rechts oben die neuen leseziechen / zuletzt geönfnfnet seingeführt“ — [Anhang-Datei] `.claude/batch-assets/2026-11-07T19-16-37-269Z-1.png`
- #4 „das ist ja visuell vom rahmen gar nicht auf einander abgestimmt, dass es ein großen kasten gemeinsam lückenlos formt mit runden ecken“ — [Anhang-Datei] `.claude/batch-assets/2026-11-07T19-17-58-552Z-1.png`
- #5 „Warum für scc app nich t auch wind9ows und versionsnsuzhmmer und mb zahl?= AUßerdem nur für colaorateur braucht es nicht für den data uploader, das erkenn tman schon am rot4en font style des da aa auplöoader. Außerdem gern unter jedem Titel namen zweizeilig eine auf den punkt bringenden verkaufstext, ich muss diesen lesen, und feststellen, verstehe was sie macht, brauche ich! Aber exakt zwei zeilen! Den Text ganz unten bitte auf maximal 3 zeiulken runterdampfen,d er ist mir zu lang dafür was er sagt, auch wenn alles wesentliche inhaltliche drin steht.“ — [Anhang-Datei] `.claude/batch-assets/2026-11-07T19-21-25-172Z-1.png`
- #6 „Bitte auch für starscape und data uplaoder die richtigen icons benutzen, die auch in tray und tgaskbar benutzt werden !“ — [Anhang-Datei] `.claude/batch-assets/2026-11-07T19-21-50-197Z-1.png`
- #7 „warum steht das nicht  au fverpasst, der 6.11 ist doch schon vorbei und es ist nicht eingetreten! Aueßerdem wurde der patch umbenannt in 5.0 ist der nächste patch laut cig roadmap website! Immer das sauch als fall berücksichtigen !  geht doch auch in patch news“ — [Anhang-Datei] `.claude/batch-assets/2026-11-07T19-30-01-284Z-1.webp`
- #8 „in der glaerie auf einem bild egal ob fullscreeen oder nicht , wo finde ich dort den upvote button : / sehe ihn aktuell nur in der galerie liste“ — [Anhang-Datei] `.claude/batch-assets/2026-11-07T19-31-13-418Z-1.webp`
- #9 „Lass uns bitet die companion level refinen  (es sollte keine companion core level geben). In Orbit finde ich irreführend und nix sagend, auch wenig motivierend so ein wording.“ → other repo, separate session (see B9)
- #10 „zeigt links unten die zeitschätzung im data uploader wirklich an wie lange der komplette run voraussichtlich dauert? Bitte beziehe versionsübergreifend lokale erkenntnisse mit ein bzgl. geschwindigkeit (ausgenommen natürlcih übersprugnenene elemente) und bitte alle phasen!“ — [Anhang-Datei] `.claude/batch-assets/2026-11-08T10-17-12-429Z-1.png`
- #11 „ich überlege die sternenkarte link auf der hauptseite etwas kleiner zu machen und mehr in die mitte zu ziehen, außerdem die sonne etwas größer übnerlege dir was angebracht und realistisch ist. Vllt. die drei planeten eihnen ticken kleiner. auch die sternenkarte etwas kleiner hier. AUßerdem fände ich gut wenn wir ein element rein bringen, was auf neues im hq hinweist, ich denke gerade an die events (falls noch offen). Aber auch ein sehr dezentes element wie die sternen karte.“ — [Anhang-Datei] `.claude/batch-assets/2026-11-08T10-20-18-335Z-1.webp`
- #12 „schau mla, immer noch probleme, auch ggf. weitere. Check das in den logs!“ + log:
  `[warn] RSI_Meteor_Collector_Military: package failed: ValueError: invalid manifest: placements[141]: id missing or duplicate`
  `[warn]   part Data/Objects/fps_weapons/gadgets/grin/multitool/gdgt_fps_grin_multitool.cdf: Data/objects/fps_weapons/gadgets/grin/multitool/gdgt_fps_grin_multitool_display.cgf: RuntimeError: cgf-converter produced no glb (rc=1)`
  `[warn]   part …/gdgt_fps_grin_multitool.cdf: …/gdgt_fps_grin_multitool_parts.skin: RuntimeError: cgf-converter produced no glb (rc=1)`
  `[warn]   part …/gdgt_fps_grin_multitool.cdf: RuntimeError: no source converted`
  `[warn] fps: 20 package(s) skipped — no record or no geometry: grin_multitool_01, grin_multitool_01_black01, … (+12 more)`
- #13 „also die letzte nachricht bezogv sicvh auf den data uploader“
- #14 „hier könnte kman  im data uploader auch h und m anzeigen! mit h und m beschriftung“ — [Anhang-Datei] `.claude/batch-assets/2026-11-08T12-58-03-064Z-1.png`
- #15 „die starscape app rechte mausklic,k menü vom tray icon hat einen anderne style als der data uploader tray menü, bitte nimm den style vom data uploader menü“

### Round 1 (concept)
- General: „biitte nochmal stark polishen und realistischer machen das konzept dann kann ich nochmal graphgfisch vor lalmen bewreten“
- Favourite: Zwei Sternbilder.
- Pin (HQ button): „irgednwas hq ähnlicheres relatable?!“ · Pin (label „HQ · 2 neu“): „2 neu hilft 0“ · Pin (popover box): „schjau mal rechts bei der sonne wie dort die infos bei hover hover angezeigtr werden, das sollte hier auch so sein! keinen kasten“
- View Level-Namen: **include „Wir werden ein Team“** (Funkstille · Erster Kontakt · Lernt dich kennen · Eingespielt · Unzertrennlich), **include „Nächster Schritt darunter“**; discard Pilotenränge, Klartext, Schiff klarmachen, Lizenzen.
- View App-Texte: **include „Nutzen zuerst“**; discard Funktion zuerst, Atmosphäre.

### Round 2
- Favourite: Station im Orbit.
- Anno (station look/size): „Das finde ich gut, aber viel hochwertiger, hochauflösender, hübscher, vllt. so wie port olisar oder halt so einen satellilten im spiel ;)“
- Anno (red/green alternate blink, white strobe every 3 s, slow drift): „sehr gut“
- Anno (no event & nothing new → station with position lights and „Alles ruhig im HQ“, or hide): „ok!“ → keep station with position lights.
- Pin (sun): „Bitte die sonne nicht so platzieren, dass sie mit den elementen überlappt, gern eetwas tiefer!“

### Round 3 (implement click)
- Favourite: **Olisar-Kreuz** (`r3-olisar`). No annotation answers → build as mocked (5 % width, 1.1× on hover, drift + position lights only, no rotation).
- Pin (Hover HQ screen): „Gern nur eine zeile, event vorrangig sonst Offene Nachscübe oder alles paletti themeatisch phrased nachricht,. die letzte hast du ja schon“

## Checklist (one line per accepted item; agents return item → done/partial/not done → evidence)

B1 Data Uploader dock, time & update (data-uploader/)
- [ ] C1 #1 root cause proven (log/code) why no update shown at start and after manual refresh; fixed so the correct channel's update shows at start; the top-right refresh also triggers an update check.
- [ ] C2 #2 dock: word „Performance“ removed, speedometer icon stays, mode text („Volle Leistung“ etc.) shown in the former „Performance“ font style.
- [ ] C3 #10 ETA covers the whole run (all phases), from locally measured speeds of earlier runs, across uploader versions, excluding skipped elements; falls back to the profile formula only without history.
- [ ] C4 #14 progress bar elapsed/remaining as „3 h 41 m“ / „Rest 3 h 19 m“ (h and m labelled), not „221:58“.

B2 Data Uploader 3D pipeline (data-uploader/python)
- [ ] C5 #12 RSI_Meteor_Collector_Military manifest „placements[141]: id missing or duplicate“ fixed at the root (unique ids), with a test.
- [ ] C6 #12 grin multitool cgf-converter rc=1 → root cause found (path length, file format, converter flag); fixed or, if the source is genuinely unconvertible, skipped quietly with a clear reason; 20 skipped multitool packages explained.
- [ ] C7 #12/#13 full uploader log scanned for further errors; each found one fixed or listed with reason.

B3 Starscape tray (wallpaper-app/)
- [ ] C8 #15 Starscape tray context menu uses the Data Uploader tray menu's style.

B4 Web apps menu (src/app/shell/apps-menu*, public/i18n)
- [ ] C9 #5 SCC App meta line „Windows · vX.Y.Z · MB“ like the others (from the scc-app-latest release data).
- [ ] C10 #5 „Nur für Collaborators“ badge removed (red Data Uploader styling stays).
- [ ] C11 #5 exactly two lines of sales copy per app (line-clamp 2 + copy that fits), tone „Nutzen zuerst“: SCC App „Dein Begleiter neben dem Spiel: Live-Infos, Overlays und Tastenbelegung, ohne Alt-Tab.“ · Starscape „Dein Desktop wird zum Fenster ins Verse — jeden Tag ein neues Bild aus der Galerie.“ · Data Uploader „Liest dein Star Citizen aus und füllt den Codex mit Schiffen, Werten und 3D-Modellen.“ (+ EN)
- [ ] C12 #5 footer ≤ 3 lines: „Hier lädst du die stabile Version. Beta und Alpha wählst du nach dem Login in der App — welche Kanäle du siehst, hängt von deiner Rolle ab.“ (+ EN)
- [ ] C13 #6 Starscape and Data Uploader icons = the real tray/taskbar icons of those apps.

B5 Codex holotable (src/app/codex/holo)
- [ ] C14 #3 block „Top 3 · Zuletzt gesehen & Hangar“ removed from the holotable.
- [ ] C15 #4 Perspektiven panel + Einsatz bar form one seamless box with shared rounded corners.

B6 Star map comet & patch rename (src/app/verse/starmap, verse data, patch news)
- [ ] C16 #7 comet tip whose date passed while the patch is not LIVE shows „verpasst“ (not „wartet auf LIVE“).
- [ ] C17 #7 patch rename handled (4.11 → 5.0 per CIG roadmap): tip, star map and patch news treat the renamed patch as the same one; general alias mechanism, not a hard-coded one-off.

B7 Gallery (src/app/verse/pages/verse-gallery-item*, lightbox)
- [ ] C18 #8 upvote button in the gallery single view, normal and fullscreen.

B8 Verse landing (src/app/verse/pages/briefing/*) — build to rounds/02.html + rounds/03.html r3-olisar
- [ ] C19 sun +45 % (≈7.6cqw), alone top right, lowered so it overlaps nothing (header buttons, title, Galerie) — per rounds/03.html (`.vl-sunb` top 14 % of stage).
- [ ] C20 star map ≈65 % size (≈5.2cqw), on half height between search and the Galerie planet.
- [ ] C21 the three hub planets −12 %.
- [ ] C22 HQ station (Olisar cross: hub, four arms, docking collars, landing pads, one parked ship, hab ring, antenna) at ≈5 % width in the left sky, lit from the top right, night-side windows; 1.1× on hover like the sun; real anchor to `/hq`.
- [ ] C23 station motion: slow drift (14 s), red/green alternating nav lights, white strobe every 3 s; reduced motion stops it.
- [ ] C24 HQ label like the sun/star map label (letters of „HQ“ rise, then value line), no box, no counter; idle hint like sun/star map.
- [ ] C25 value line is exactly ONE line: open event first (e.g. „Event IAE 2956 läuft · noch 5 Tage“), else open Nachschub („1 Nachschub-Wunsch wieder lieferbar“), else a thematic all-clear message („Alles ruhig im HQ“); data from the HQ events (#1010) and Nachschub services.

B9 Companion level (other repo P:\Projects\Star-Citizen-Companion-App) — separate session
- [ ] C26 level names 0–4: Funkstille · Erster Kontakt · Lernt dich kennen · Eingespielt · Unzertrennlich (DE) + EN equivalents; „Companion Core“ wording for the level gone (tooltip, title), it is the Companion-Level.
- [ ] C27 a small line under the level name names the next step (e.g. „Nächste Stufe: Intel einrichten“).

Drift since concept start (mention only): brand/host rename to Verse Companion / versecompanion-alpha (#1012), HQ limited-time events as a Nachschub way (#1010) — use #1010's data for C25.
