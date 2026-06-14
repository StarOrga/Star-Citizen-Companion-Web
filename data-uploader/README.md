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
