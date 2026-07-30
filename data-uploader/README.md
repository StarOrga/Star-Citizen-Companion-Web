# Star Citizen Companion - Data Uploader

Lokaler P4K-Scanner mit Live-Progress, Quality-Score und gegenseitig-verifiziertem
Upload zur Web-App. Eigenständiges Desktop-Tool, getrennt von der Haupt-App
(„SC Companion").

## Status

**Phase 1 (Foundation) — implementiert.**
Lauffähiger Electron-Shell mit Discovery-Cascade (3-Stufen: RSI-Launcher-Config →
FS-Scan → Manual), 4 Performance-Profilen, OAuth-Loopback + Release-Token-Header,
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

## Architektur

```
src/
├── main/         # Electron-Hauptprozess
│   └── index.ts  # Fenster + IPC-Handler + OAuth-Server
├── preload/      # Sichere IPC-Bridge zum Renderer
│   └── index.ts
├── renderer/     # Browser-UI (Verse-Compass-Theme)
│   ├── index.html
│   ├── main.ts
│   └── styles.css
├── lib/          # Domain-Logic (im Main-Prozess geladen)
│   ├── discovery.ts       # 3-Stufen-Cascade
│   ├── performance.ts     # Profil-Definitionen + ETA
│   ├── throttle-control.ts # Live-Profil (mid-run umschaltbar) + Pacing
│   ├── process-throttle.ts # OS-Kommando für Priorität/Affinität
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

## Performance-Profil (live umschaltbar)

Das Profil (`minimal` / `standard` / `maximum` / `auto`) ist **kein**
Start-Snapshot: es lässt sich mitten im laufenden Job wechseln — runter, wenn
gezockt wird, hoch, wenn der PC ohnehin ungenutzt ist. Der Job wird dafür
weder abgebrochen noch neu gestartet.

- **Quelle der Wahrheit** ist der Main-Prozess (`main/throttle.ts`), nicht der
  Renderer: nur er kennt die PIDs der laufenden Sidecars, und er überlebt einen
  Renderer-Reload. Der Renderer hält nur einen Spiegel und schreibt über
  `sc:perf:set`.
- **Python-Sidecar** (der eigentliche CPU-/Disk-Fresser) ist nicht unsere
  Schleife und kann nichts nachlesen. Stattdessen setzt jeder Wechsel
  Prioritätsklasse + CPU-Affinität des laufenden Prozesses neu
  (`lib/process-throttle.ts`; Windows via PowerShell, POSIX via `renice`). Das
  greift sofort und kann per Konstruktion keine halb geschriebene Datei
  beschädigen, weil es die Job-Logik nicht anfasst.
- **Upload-Stufen** (Catalog-Chunks, Skin-PUTs) sind unsere Schleife: sie rufen
  an denselben sicheren Grenzen wie `PauseControl.checkpoint()` zusätzlich
  `throttle.pace()` auf. Das liest das Profil **pro Work-Unit** neu — ein
  Wechsel wirkt ab der nächsten Unit, nie mitten in einem Request.
- **Nicht live** ist der Extraktions-*Scope* (HD-Icons, Render-PNGs,
  Component-Tree): der entscheidet, *welche* Dateien der Sidecar abarbeitet, und
  seine Planung läuft schon. Scope bleibt für den Lauf fest; die UI sagt das.

Das Umschalt-UI hängt auf Configure (groß, mit ETA) sowie auf der Run- und der
Upload-View (kompakt) — überall derselbe Schreibpfad.

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
