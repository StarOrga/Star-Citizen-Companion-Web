# Star Citizen Companion - Data Uploader

Lokaler P4K-Scanner mit Live-Progress, Quality-Score und gegenseitig-verifiziertem
Upload zur Web-App. Eigenständiges Desktop-Tool, getrennt von der Haupt-App
(„SC Companion").

## Status

**Phase 1 (Foundation) — implementiert.** Seit 0.33.0 als One-Screen Guided Run,
heute **vertikal geschnitten**: Schritt-Schiene Installation → Codex →
Silhouetten → 3D-Modelle → Fertig. Jeder mittlere Schritt ist ein eigener Screen
und bringt EIN Thema komplett von der Data.p4k bis auf den Server, bevor der
nächste beginnt:

| Schritt | bauen | hochladen |
|---|---|---|
| Codex | Daten extrahieren | Bundle · Einträge (Build geht live) |
| Silhouetten | Umrisse bauen | an denselben Codex-Build hängen (`mode: 'silhouettes'`) |
| 3D-Modelle | Modelle bauen | Modelle hochladen |

Die schwere lokale Arbeit kommt so in drei getrennten Blöcken statt einem langen,
und jedes Thema ist auf der Website, sobald sein Schritt durch ist. Nach einer
erfolgreichen Extraktion folgt der Upload automatisch (angemeldet vorausgesetzt;
sonst bietet der Fuß „Anmelden & hochladen“). Pro Lauf gibt es einen Chip:
⏻ "Wenn fertig": nichts / Programm beenden / PC herunterfahren (pro Lauf, nie
gespeichert). Wie viel vom PC ein Lauf nehmen darf, regelt das **Ressourcen-Dock**
am unteren Fensterrand (siehe unten). Die Automatik (neue Patches ohne Zutun
hochladen) und alles andere Dauerhafte liegt hinter ⚙ (Ctrl+,).
Konzept: `docs/concepts/2026-09-20-data-uploader-one-screen.html` (Runden 1–3 + Abschlussbericht).
Lauffähiger Electron-Shell mit Discovery-Cascade (3-Stufen: RSI-Launcher-Config →
FS-Scan → Manual), Ressourcen-Dock mit Governor, OAuth-Loopback + Release-Token-Header,
i18n (DE/EN + Stubs für ES/FR/PT/RU/ZH).

**Phase 2 (Domain) — offen.**
Echte P4K-Extraktion (HD-Icons + Render-PNGs + Component-Tree),
Schema-Score-Validator, Server-Diff. Siehe Open Questions in
`docs/concepts/2026-05-20-p4k-companion-desktop-tool.html`.

## Quick start

```bash
# Erstmal Deps installieren
npm install

# Dev-Modus (Electron + Vite-HMR)
npm run dev

# Build (production)
npm run build

# Tests (Vitest)
npm test

# Windows-Installer + Portable
SC_RELEASE_TOKEN=<release-uuid> npm run package:win
```

`npm run dev` läuft mit eigenem userData-Verzeichnis (`<userData>-dev`, siehe
`src/main/dev-user-data.ts`): eigener Single-Instance-Lock, eigene Settings,
Session und Job-Datei. Ein installierter Uploader im Tray blockiert den
Dev-Start deshalb nicht mehr (#632) — eine Dev-Sitzung muss sich aber einmal
separat anmelden.

## Architektur

```
src/
├── main/         # Electron-Hauptprozess
│   └── index.ts  # Fenster + IPC-Handler + OAuth-Server
├── preload/      # Sichere IPC-Bridge zum Renderer
│   └── index.ts
├── renderer/     # Browser-UI (SCC-Brand-Theme) — ein Bildschirm, geführter Lauf
│   ├── index.html         # Shell: Kopfstreifen (Schiene, Verbindungs-Chip, ⚙), Bühne, Bodenleiste
│   ├── main.ts            # State + IPC + startRun(plan) + Extract/Upload-Engine
│   ├── steps/             # install (Startrampe + Start), done, category-bars, upload-stages (Zeilen je Schritt)
│   ├── shell/             # step-rail, chevrons (nur vor dem Start), bottom-strip
│   ├── resource-dock.ts   # Ressourcen-Dock: Tachos für CPU / RAM / Disk (Taste T)
│   ├── when-done-chip.ts  # ⏻ Wenn fertig
│   ├── settings-dialog.ts # Automatik (neue Patches ohne Zutun) + Allgemein (Tray, Ring, Sprache, Telemetrie)
│   ├── connection-popover.ts · log-drawer.ts · keymap.ts
│   ├── progress.ts        # Progress-Karte (unverändert)
│   └── styles.css
├── lib/          # Domain-Logic (im Main-Prozess geladen)
│   ├── discovery.ts       # 3-Stufen-Cascade
│   ├── performance.ts     # alte Profil-Definitionen + ETA (nur noch für sc:estimate)
│   ├── resource-limits.ts # Ressourcen-Grenzen: Skalen, Voreinstellungen, Worker-Zahl
│   ├── extractor.ts       # P4K-Pipeline (Phase 2)
│   ├── validator.ts       # Quality-Score (Phase 2)
│   ├── oauth.ts           # Loopback-OAuth-Flow
│   ├── uploader.ts        # POST mit Release-Token-Header
│   ├── release-token.ts   # Build-Time-Constant
│   └── i18n.ts            # Translation-Loader
└── i18n/
    ├── de.json
    ├── en.json
    └── {fr,es,pt,ru,zh}.json   # Stubs (English-Fallback)
```

## Ressourcen-Dock (CPU · RAM · Disk, live)

Die drei Tempo-Profile (Minimal / Standard / Maximal) sind ersetzt. Sie stellten
nur Worker-Zahl und Prioritätsklasse ein — und keiner der beiden Hebel erreicht
das, was PCs lahmgelegt hat: die **Disk**. Auch auf „Minimal“ las die Extraktion
die P4K so schnell, wie das Laufwerk konnte; Disk 100 %, Windows hing mit.

Jetzt hat jede Ressource ihre eigene Grenze, auf einer Skala, die aus dem PC
abgeleitet ist (`src/lib/resource-limits.ts`):

| Ressource | Skala | Durchsetzung |
|---|---|---|
| Prozessor | 0–100 % der ganzen Maschine, Grenze max. **90 %** | harte CPU-Grenze per Windows **Job Object** um den ganzen Sidecar-Baum |
| Arbeitsspeicher | Gesamt-RAM − 2 GB für Windows; belegt von anderen Programmen + Uploader-App wird live abgezogen | bestimmt die Worker-Zahl des nächsten Schritts (ein hartes Commit-Limit würde Allokationen scheitern lassen und den Lauf abstürzen) |
| Disk lesen / schreiben (MB/s), Disk-Zugriffe (/s) | Laufwerksklasse der Data.p4k (NVMe / SATA-SSD / HDD, per `Get-PhysicalDisk`) | Governor pausiert den Baum genau so lange, bis das Budget wieder im Plus ist (Duty-Cycle, 250 ms Auflösung) |
| Grafikkarte | — | wird nicht genutzt (alles läuft auf der CPU); das Dock sagt das |

- **Governor** (`python/sc_extract/governor.py`): ein kleiner Prozess pro
  laufendem Sidecar (`main/resources.ts` startet ihn in `registerJob`). Er legt
  den Sidecar in ein Job Object — jeder Worker, `cgf-converter` und der
  glTF-Worker entstehen danach darin —, setzt Idle/BelowNormal-CPU-, sehr
  niedrige/niedrige I/O- und niedrige Speicher-Priorität, misst CPU/RAM/I/O
  über die Job-Accounting-Zähler und meldet einmal pro Sekunde einen Messwert.
  Grenzen kommen als JSON-Zeilen über stdin und wirken **sofort**, mitten im
  Schritt. stdin zu (Uploader weg) = alles fortsetzen und beenden — ein
  angehaltener Baum bleibt nie zurück.
- **Main ist die Quelle der Wahrheit** (`main/resources.ts`), gespeichert in den
  Settings (`resourceLimits`; das alte `speedProfile` wird beim ersten Start
  auf die passende Voreinstellung abgebildet). Der Renderer spiegelt nur.
- **Dock** (`renderer/resource-dock.ts`): eingeklappt eine Zeile (Verbrauch /
  Grenze je Ressource), ausgeklappt (Taste T) ein Tacho pro Ressource: Skala des
  PCs, schraffiert was andere Programme gerade belegen, heller Bogen bis zum
  Griff = Grenze (ziehen oder Pfeiltasten), Nadel = aktueller Verbrauch des
  Laufs. Voreinstellungen „Beim Spielen“ / „Ausgewogen“ / „Volle Leistung“
  füllen nur die Regler.
- **Upload-Schleifen** (Catalog-Chunks, Livery-PUTs) laufen im Main-Prozess, nicht
  im Sidecar; sie pausieren bei kleiner CPU-Grenze kurz zwischen den Work-Units
  (`pacer()`), nie mitten in einem Request.
- Live-Messwerte gibt es nur, solange ein Lauf läuft oder ein sichtbares
  Fenster zusieht — das Tray-Idle-Budget bleibt bei null periodischer Arbeit.
- Außerhalb von Windows gibt es keinen Governor; dort wirkt nur die Worker-Zahl,
  und das Dock sagt das.

## Pause, Fortsetzen & Fehlertoleranz

Ein Voll-Upload läuft Stunden und besteht aus tausenden Requests. Beides —
„der Operator will anhalten" und „ein Request geht schief" — darf den Lauf
nicht wegwerfen.

- **Pause wirkt auf zwei Wegen**, weil es zwei Arten von Arbeit gibt. Unsere
  eigenen Schleifen (Catalog-Chunks, Skin-PUTs) prüfen zwischen den Work-Units
  `PauseControl.checkpoint()` und rollen sauber aus. Der **3D-Skin-Build** ist
  dagegen ein Python-Kind, das stundenlang niemanden fragt — `sc:upload:pause`
  killt es deshalb aktiv (`interruptLocalSkinBuild`). Das ist unbedenklich,
  weil `skin_export_app` die `skins.json` eines Schiffs erst nach dessen
  vollständigem Export schreibt und `--skip-existing` genau darauf keyt: beim
  Fortsetzen wird nur das eine angefangene Schiff neu gebaut.
- **Transiente Serverfehler beenden keinen Lauf.** Jeder `ingest-catalog`-Request
  wird bei einem vorübergehenden Fehler mit exponentiellem Backoff wiederholt
  (5 Versuche). Meldet Postgres dagegen ein abgebrochenes Statement
  (`503 ingest_timeout`, bzw. das rohe `canceling statement …` einer älteren
  Function), hilft Wiederholen nie — der **Batch wird halbiert** und beide
  Hälften gehen raus. Die reduzierte Größe gilt für den Rest der Phase weiter.
  Alle Ops sind idempotente Upserts, das Aufteilen kostet also nichts.
- **Ein gescheiterter Codex-Schritt bleibt fortsetzbar.** Der Job wird als
  `error` markiert, aber weder die Job-Datei noch das `out_dir` werden gelöscht
  — „Upload fortsetzen" macht am gespeicherten Cursor weiter. Aufgeräumt wird
  ausschließlich nach einem vollständig bestätigten Lauf.

## Unveränderte Subthemen überspringen

Jeder Kategorie-Balken ist ein **Subthema** (Strings, Schiffe, Komponenten,
Waffen, Items, Codex-Extras, Silhouetten, 3D-Hüllen — `src/lib/subthemes.ts`).
Der Server führt pro Kanal + Patch + Build (`build_manifest.id` →
`RequestedP4ChangeNum`) mit, welches Subthema mit welcher **Revision**
hochgeladen wurde (`uploader_subtheme_uploads`, RPCs
`list_uploader_subthemes` / `record_uploader_subthemes`). Vor dem Lauf
vergleicht der Uploader diese Liste mit seinen eigenen Revisionen und lässt
alles weg, was schon aktuell ist; ist nichts offen, startet keine Extraktion.

- **Konservativ:** unbekannter Build, nicht lesbare Liste oder der Schalter
  „Alles neu erzwingen“ im Installieren-Schritt → nichts wird übersprungen.
  Eine Zeile wird erst geschrieben, wenn ein Subthema vollständig angekommen ist.
- **Revisionen werden von Hand erhöht**, sobald eine Änderung ändert, was ein
  Subthema auf den Server legt. `scripts/check-subtheme-revisions.mjs` (PR-Job
  in `data-uploader-build.yml`) lehnt einen Branch ab, der die `sources` eines
  Subthemas ändert, ohne dessen Revision zu erhöhen — außer ein Commit trägt
  `Subtheme-Unchanged: <keys>` (oder `all`).
- Die fünf Codex-Kategorien teilen sich eine Extraktion: ist eine davon offen,
  wird voll extrahiert und nur der Upload der übrigen gespart.

## Idle behaviour (tray, no job)

With no job running and the window closed, the uploader does no periodic work:
the only timers are the 6 h update poll and the job-scoped watchdog / progress
ticker. The budget, summed over all uploader processes (main, renderer, GPU,
network service), 5 min after an autostart:

| Metric | Budget |
|---|---|
| Write operations (`Win32_Process.WriteOperationCount`) | < 50 per 30 s |
| Written bytes (`WriteTransferCount`) | < 10 KB/s |
| `%APPDATA%/@sc-companion/data-uploader/logs/main.log` | +0 bytes over 5 min |

Those counters include pipe/IPC traffic, not only disk. That is how 0.35.1 blew
the budget (~4,170 writes / 4.6 MB per 30 s) without writing a single file: the
autostart (`--hidden`) never showed the window, and a never-shown BrowserWindow
still reports `visibilityState: 'visible'`, so the infinite connection-dot pulse
kept the renderer and GPU process exchanging frames. The hidden start now calls
`hide()` explicitly on `ready-to-show` (`src/lib/window-visibility.ts`), which
stops rendering — the same state a window closed via X was already in.
`paintWhenInitiallyHidden: false` does not achieve this on Electron 44.

Check it with the probe (Windows; stops a running uploader, launches it with
`--hidden`, exits 1 over budget):

```bash
npm run test:idle-io                                   # installed app
npm run test:idle-io -- --attach --warmup 0 --window 30  # the instance already running
npm run test:idle-io -- --exe node_modules/electron/dist/electron.exe --app .  # unpackaged out/ build
```

`test/idle-io.spec.ts` guards the hidden-start `hide()` and the budget maths in
the regular `npm test` run.

## Security-Modell (Iter 2 · § B2)

1. **Loopback-OAuth**: App startet HTTP-Server auf 127.0.0.1:46821,
   öffnet Browser bei `<api-base>/uploader/auth?cb=<loopback>`, User loggt sich
   ein, Browser redirected mit signiertem Token.
2. **Release-Token-Header**: Beim Upload sendet die App
   `X-SC-Release-Token: <build-injected-uuid>`. Server prüft gegen
   `desktop_releases.release_token`-Allowlist. Mismatch = HTTP 403.

Beide müssen passen — sonst kein Upload.

## CI / Distribution

- GitHub-Actions baut auf Tag-Push einen Windows-x64-Build.
- Artefakte werden als GitHub-Release-Assets hochgeladen (private Repo).
- Die `desktop_releases`-Row mit `release_token` wird per Admin-RPC bei jedem
  Release angelegt — der Token landet als env-var im Build.

Siehe `.github/workflows/data-uploader-build.yml`.

## Testing

- `vitest` für Unit-Tests von `lib/*` (lauffähig ohne echte P4K).
- **Real-P4K-Tests sind manuell** (siehe Open Question #2 im Concept-Final-Report):
  Jeremy verifiziert pro Release einmal mit echter Live-Channel `Data.p4k`.
