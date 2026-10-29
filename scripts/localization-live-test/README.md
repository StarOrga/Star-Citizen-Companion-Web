# Localization live test (≈ 10 min)

Answers what no source documents: does Star Citizen pick up a changed
`global.ini` or a language switch **without a restart**? The SCC app's "apply
live" behaviour is built on the answer.

Background: in stock CryEngine 5 the `g_language` cvar has a change callback
that reloads the localization at runtime (`System.cpp`,
`OnLanguageCVarChanged`). Star Citizen runs a heavily modified fork — untested.

## Steps

1. Game closed. Run `install.ps1` (variant A). It writes a marker file and
   `user.cfg` (`g_language = german_(germany)`, `g_languageAudio = english`),
   backing up whatever was there.
2. Start the game. Open **Options**: every entry should read `[A] …`.
   → No marker: the game ignores loose localization files (stop here, note it).
3. Stay in the main menu. Run `install.ps1 -Variant B`.
   → `LOCKED …` printed: the game holds the file open (note it).
4. Close and reopen Options (also try a different tab, then the pause menu in
   the PU). `[B] …` appears → the file is re-read live. Still `[A]` → it is not.
5. Open the console (`~`) and type `g_language english`, then
   `g_language german_(germany)`. Note whether the menu flips between plain
   English and `[B]`, and whether the console rejects the cvar.
6. Close the game, run `uninstall.ps1`. Optional: launcher → **Verify** to see
   whether it deletes `data\Localization` (check the folder afterwards).

Report the five observations (marker shown · file locked · live re-read ·
console switch · Verify deletes) — that decides between "apply live", "apply
via console hint" and "restart required" in the app.
