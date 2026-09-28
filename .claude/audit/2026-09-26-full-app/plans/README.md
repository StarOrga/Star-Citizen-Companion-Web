# Umsetzungspläne zum Audit 2026-09-26: Index

Dieses Verzeichnis enthält 19 Umsetzungspläne `D01.md` … `D19.md`. Jeder Plan setzt einen Entscheidungsblock aus `docs/concepts/2026-09-27-audit-0104-entscheidungen.html` um und ist für eine **lokale Claude-Code-Session** im Repo `Star-Citizen-Companion-Web` geschrieben. Die Befunde selbst stehen in `../findings.md`, die REQ/RULE-Liste in `../requirements.md`.

Stand aller Pläne: main = 0.104.1 (`1b08612`), geprüft am 2026-09-28. Jeder Plan wurde nach dem Schreiben gegengelesen und korrigiert. Beim Bau dieses Index wurden zusätzlich die Widersprüche zwischen den Plänen aufgelöst (Abschnitt 4a).

## 1. Kurzanleitung

1. **Ein Plan pro Session.** Im Repo-Root eine neue Claude-Code-Session starten und genau eine Zeile schicken:

   ```
   Setz .claude/audit/2026-09-26-full-app/plans/DNN.md um.
   ```

   `DNN` ist die Plannummer. Die Zeilen in Wellen-Reihenfolge (Abschnitt 3):

   ```
   Setz .claude/audit/2026-09-26-full-app/plans/D19.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D04.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D01.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D03.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D12.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D10.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D02.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D05.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D07.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D13.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D06.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D08.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D11.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D14.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D16.md um.   (PR 1 und PR 2)
   Setz .claude/audit/2026-09-26-full-app/plans/D17.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D09.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D18.md um.
   Setz .claude/audit/2026-09-26-full-app/plans/D16.md um.   (PR 3, Schritte 12–15)
   Setz .claude/audit/2026-09-26-full-app/plans/D15.md um.
   ```

2. **Ein Plan = ein Branch = ein PR**, jeweils frisch von aktuellem `main` (main ist per Hook geschützt). Branchname und Commit-Schnitt stehen im Plan unter „Branch, Commits, PR“. Einzige Ausnahme: D16 ist in drei PRs geteilt.
3. **Die Session arbeitet den Plan von oben ab:** zuerst „Vorab prüfen“ (dort steht auch, welche anderen Pläne schon gemergt sein sollten und was sich dadurch ändert), dann die Schritte, ein Commit pro Schritt.
4. **Vor dem PR alle Prüfungen aus „Tests und Verifikation“ laufen lassen:** mindestens `npm run typecheck`, `npm test`, `npm run build`, dazu die plan-eigenen Tests und die Browser-Prüfung auf Desktop und 390 px. Auf Linux/macOS ist `npm run test:gate` erst nach D19 grün.
5. **Ausliefern ist ein eigener Schritt.** Kein Plan setzt eine Versionsnummer oder einen CHANGELOG-Abschnitt. Nach einem oder mehreren Merges ausliefern, mit `/ship`.
6. **Owner-Schritte macht die Session nicht.** Sie stehen in jedem Plan unter „Manuelle Schritte“ und gesammelt in Abschnitt 5. Die offenen Entscheidungen aus Abschnitt 6 möglichst vor dem Start des betroffenen Plans beantworten.
7. **Innerhalb einer Welle** können mehrere Sessions parallel laufen. Wer zweitens mergt, rebased auf main; die Pläne sagen jeweils, was dabei zu beachten ist.

## 2. Übersicht

„Abweichung“ heißt: Der Owner hat eine andere Option gewählt als die Empfehlung des Audits.

| Plan | Thema | Option | Größe | Abhängig von | Manuelle Schritte |
|---|---|---|---|---|---|
| [D01](D01.md) | Sicherheit und Datenschutz | A „Kritisches Paket jetzt“ | L (9 Schritte) | keine harte (empfohlen nach D19) | Secrets vor dem Merge prüfen; `db:push` erst nach Vercel READY; nächster Uploader-Tag |
| [D02](D02.md) | Löschen scheitert in der Datenbank | A „Eine Korrektur-Migration“ | M (10) | keine harte (empfohlen nach D01; nutzt D01-Bausteine B1–B3 als Anleitung) | `db:push` vor dem Merge (mit Dry-Run), SQL-Kontrollen |
| [D03](D03.md) | Bestätigen vor dem Löschen | A „App-Dialog und ehrliches Konto-Löschen“ | L (8) | keine | keine |
| [D04](D04.md) | Automatische Prüfung für die Web-App | **B „Volle CI“ (Abweichung, Empfehlung A)** | L (7) | **D19** (Pflicht) | Required Checks setzen, Secrets-Entscheidung, Node in Vercel prüfen, Actions-Minuten |
| [D05](D05.md) | Verständliche Fehlermeldungen | A „Zentraler Übersetzer und Logging“ | L (13) | keine harte (empfohlen nach D03, gemeinsame `core/edge-error.ts`) | Edge-Deploy + Probe `test@invalid`, PostHog-Probe |
| [D06](D06.md) | Robust bei Netzproblemen | A „Robustheits-Paket“ | L (8) | **D05** | keine (optional PWA offline auf echtem Gerät) |
| [D07](D07.md) | Tastatur und Screenreader | A „Dialog-Baustein und Grundgerüst“ | L (8) | **D03** Schritt 1 (sonst hier nachbauen) | keine |
| [D08](D08.md) | Restliche Browser-Tooltips und Auswahllisten | A „Alles umstellen“ | M (9) | **D07**, **D03** (Ersatzwege im Plan) | keine |
| [D09](D09.md) | Handy- und Layout-Feinschliff | A „Feinschliff-Paket“ | M (9) | keine harte (empfohlen nach D17 und D08) | Sichtprüfung auf echtem iPhone |
| [D10](D10.md) | Rot und Gefahr nur, wo sie hingehören | **B „Markenfarben als Ausnahme“ (Abweichung, Empfehlung A; Owner-Notiz: Original-Icon, neutrales Label)** | S (6) | keine | Logo-Freigabe, Entscheidung Kachelrahmen |
| [D11](D11.md) | Kleine Funktionsfehler | A „Alle beheben“ | M (6) | keine (muss vor D17) | keine |
| [D12](D12.md) | Assets-Worker und Edge Functions | A „Worker- und Edge-Paket“ | M (7) | keine (muss vor D13) | `wrangler deploy`, Live-Checks |
| [D13](D13.md) | Data Uploader und Browser-Erweiterung | A „Bugfix-Release“ | M (6) | **D12** | Uploader-Release (mit D01), LIVE-Neuimport |
| [D14](D14.md) | Ladezeit und Tempo | **B „Plus Admin-Polling“ (Abweichung, Empfehlung A)** | L (8) | weich: D05 Schritt 10, D06 (`READ_RPCS`) | `db:push` (mit Dry-Run) |
| [D15](D15.md) | Bewegung und Hover | **A „Aufräumrunde“ (Abweichung, Empfehlung B)** | L (12) | **D17** (Pflicht, CSS-Budget); D09, D10, D18 vorher | keine (optional Touch-Gerät) |
| [D16](D16.md) | Test-Lücken | **B „Breit“ (Abweichung, Empfehlung A)**; 3 PRs, PR 1 = Umfang von A | XL (15) | weich: D01, D02, D03, D05, D06, D07, D11 | `gate:mobile:auth`, ggf. Docker für `test:db` |
| [D17](D17.md) | Große Bausteine und Duplikate | **B „codex-detail zerlegen“ (Abweichung, Empfehlung A)** | L (8) | **D05, D11, D16 (PR 1 + Schritt 6)** | keine (wünschenswert `gate:mobile:auth`) |
| [D18](D18.md) | Begriffe, Texte und Doku | A „„Set“ überall und Doku-Runde“ | M (10) | **D05**; empfohlen nach D01, D02, D13 | keine (Workflow-Läufe ansehen) |
| [D19](D19.md) | Werkzeuge und das Plugin in Cloud-Sessions | A „Hook-Fix und Plugin für Cloud“ | S (3) | keine | Cloud- und Desktop-Gegenprobe, Tag `alpha/v0.104.0` |

Sechs Abweichungen von der Empfehlung: D04, D10, D14, D15, D16, D17. Eine Owner-Notiz gibt es nur zu D10.

## 3. Reihenfolge in Wellen

Innerhalb einer Welle können die Pläne parallel laufen. Die nächste Welle beginnt, wenn die vorige gemergt ist. Die Spalte „in der Welle“ nennt eine Merge-Reihenfolge, wo sie Arbeit spart.

| Welle | Pläne | in der Welle | Warum |
|---|---|---|---|
| 0 | D19 | – | Macht `npm run test:gate` auf Linux/macOS grün, das D01, D02 und die CI aus D04 als Gate verlangen; klein, ohne App-Änderung. |
| 1 | D04, D01, D03, D12, D10 | D04 zuerst, dann beliebig | Legt die Grundlagen: D04 die CI, die ab dann jeden PR prüft; D03 den Dialog-Baustein, den Bestätigungsdienst und den Build-Guard für D07/D08; D01 das Sicherheitspaket samt Migrations-Bausteinen B1–B3; D12 die R2-Fristen, auf die D13 aufbaut; D10 den kleinen Anfang der Kette D10 → D17 → D09 → D18 → D15. |
| 2 | D02, D05, D07, D13 | D02 vor D05 | Baut direkt auf Welle 1 auf: D02 nach D01 (gleiche Dateien, Migrationsreihenfolge); D05 nach D03 (gemeinsame `core/edge-error.ts`) als Basis für D06/D14/D17/D18; D07 setzt `ScDialogDirective` aus D03 ein; D13 nach D12 und im selben Uploader-Release wie D01 Schritt 6. |
| 3 | D06, D08, D11, D14 | D06 vor D14 | Verbraucher der Welle 2: D06 braucht `logWarn`/`describeError` aus D05; D08 braucht `.sc-sr-only`, `stageTitle` und den Guard aus D03/D07; D11 muss vor D17 liegen; D14 Schritt 7 baut auf D05 Schritt 10 auf und trägt seine RPC in D06s `READ_RPCS` ein. |
| 4 | D16 PR 1 und PR 2 | PR 1, dann PR 2 | Die Specs prüfen jetzt das Zielverhalten von D01–D07 und D11 statt des alten; PR 1 und Schritt 6 (in PR 2) sind das Sicherheitsnetz, das D17 verlangt. |
| 5 | D17 | – | Zerlegt `codex-detail` erst, wenn D05, D11 und die Charakterisierungs-Specs drin sind; macht das CSS-Budget frei, das D09 und D15 brauchen. |
| 6 | D09, D18, D16 PR 3 | D09 vor D18 | D09 nach D17 (`.sl-input` liegt dann in der Teilkomponente); D18 scannt tote i18n-Schlüssel, wenn alle neuen Schlüssel da sind, und übernimmt die Migrationszeilen aus D01/D02/D14; D16 PR 3 (REQ-Checks, Gate, pgTAP) läuft parallel. |
| 7 | D15 | – | Der Hover-Codemod fasst rund 90 Dateien an und läuft deshalb zuletzt auf frischem main; er braucht das Budget, das D17 freimacht. |

Danach, außerhalb dieser Pläne: der reine Ordner-Umzug AUD-357 als allerletzter PR (siehe D17, „Bewusst nicht Teil“), dann die Folge-Issues aus den Abschnitten „Bewusst nicht Teil dieses Plans“.

## 4. Konflikte

### 4a. Beim Index-Bau aufgelöste Widersprüche

Diese Stellen widersprachen sich zwischen zwei Plänen. Die Plan-Dateien sind entsprechend geändert; jede Änderung beschreibt beide Merge-Reihenfolgen.

| Pläne | Widerspruch | Geändert |
|---|---|---|
| D03 ↔ D05 | Beide verschoben denselben Body-Leser `readErrorBody` aus `ship-link.service.ts` in je eine **andere** neue Datei (`core/edge-function-error.util.ts` als `readEdgeFunctionError` bzw. `core/edge-error.ts`). Dazu übersetzten beide die Fehler des Konto-Löschens in `settings.component.ts`, mit zwei verschiedenen Schlüsselsätzen (`settings.danger.errors.*` bzw. `admin.delete.err.*`). | Eine Datei `src/app/core/edge-error.ts` mit `readErrorBody` (unverändert) plus D05s `readEdgeErrorCode`, eine Spec `edge-error.spec.ts`. Die Abbildung des Konto-Löschens gehört D03; das Signal hält den Schlüssel, das Template übersetzt (D05-Konvention). D03 Schritt 5 und „Abhängigkeiten“, D05 Schritte 9, 10, Tests, „Abhängigkeiten“. |
| D13 ↔ D18 | D13 löscht `public/i18n/{es,fr,pt,ru,zh}.json`; D18 bearbeitete „alle sieben“ Dateien und beschrieb sie in der README als Stubs. Beide löschten die Uploader-Schlüssel `run.tempo`/`common.tempo` und bauten je eine eigene Paritäts-Spec. D13 behauptete „keine Überschneidung“. | D18 Schritte 1, 3, 4, 7, Definition of Done, Tests, Abdeckung, „Abhängigkeiten“ (nach D13 entfällt der Uploader-Teil, die Skripte arbeiten auf vorhandenen Dateien); D13 Schritt 2 und „Abhängigkeiten“. |
| D02 ↔ D05 | D05 Schritt 8 ändert `buildsForChannel()` auf `{ builds, failed }` und legt `recentLiveBuildsOrThrow()` an. D02s Spec erwartete weiter `[]`, und D02s Filter „nur fertige Builds“ fehlte in der neuen Variante. | D02 Schritt 9 und „Abhängigkeiten“, D05 Schritt 8: Filter an allen drei Abfragen, Spec-Erwartung je nach Stand. |
| D01 ↔ D05 | D01s Signierdienst schreibt `console.warn`; D05s Build-Guard `check-raw-errors` lehnt `console.*` außerhalb von `core/log.ts` ab. Mit D05 zuerst wäre D01s Build rot. | D01 Schritt 1 und „Abhängigkeiten“: nach D05 `logWarn`. |
| D06 ↔ D16 | D16 erwartete von `armorRating` bei einem Fehler `null`; D06 Schritt 6 ändert die Rückgabe auf `{ rows }` bzw. `{ failed, error }`. | D16 Schritt 12 und D06 Schritt 6: Erwartung je nach Stand. |
| D06 ↔ D14 | D06s Spec legt `READ_RPCS.size === 22` fest; D14 Schritt 5 bringt eine weitere lesende RPC `admin_feedback_board_delta`. | D06 Schritt 1 und „Abhängigkeiten“: wer zweitens mergt, trägt sie ein, Größe 23 (D14 Schritt 7 sagte das schon für die andere Reihenfolge). |
| D05, D06, D07, D11 ↔ D16 | D16s Specs hätten nach den anderen Plänen falsche Erwartungen gehabt: `api-tokens.service` wirft nach D05 Codes statt Meldungen (und trägt nach D06 ein `signal`); die Schnellsuche hört Escape nach D07 am Panel statt am `document`; D11 legt in `app.component.spec.ts` einen eigenen `SupabaseClientProvider`-Stub an; D05 legt `hangar-ship-detail.component.spec.ts` schon an. | D16 „Vorab prüfen“ Punkt 1, Schritte 1, 3, 4. |
| D04 ↔ D03, D07, D09, D15, D16 | D04 macht `prefer-on-push-component-change-detection` zum Error für alle `src/**/*.ts`, auch für Specs. Heute haben 21 von 26 Specs mit Test-Host-`@Component` kein OnPush, und fünf Pläne legen weitere an. `npm run lint` wäre von Anfang an rot gewesen. | D04 Schritt 4: eigener Block, der die Regel für `*.spec.ts` und `src/app/testing/**` abschaltet. |
| D11, D14 ↔ D09, D15, D17 | D09 und D15 verlangen „keine neue Budget-Warnung“ und haben gemessen: `codex-detail` liegt rund 50 B unter 18 kB. D11 und D14 (Welle 3, vor D17) legten dort neue CSS-Regeln an. | D11 Schritt 4: vorhandene Klasse `.err-inline` mitbenutzen; D14 Schritt 1: Platzhalterhöhe als Inline-Style; D17 Schritte 3 und 4: `.err-inline`/`.add-err` mitkopieren, `.err-inline` bleibt auch im Parent (Where-to-buy). |
| D15 ↔ D17 | D15 Schritt 5 sagte, der Hero liege nach D17 in einer Teilkomponente; D17 (und D15s eigene „Abhängigkeiten“) behalten ihn im Parent. | D15 Schritt 5. |
| D03 ↔ D08 | D08 erweitert D03s Guard `check-native-ui.mjs` um `/<select\s/`. Prüft das Skript zeilenweise, verfehlt das Muster drei der sieben Selects (dort steht `<select` allein am Zeilenende, derselbe Fehler, den der Review beim Grep fand). | D08 Schritt 9: `/<select(?:\s|$)/m`. |
| D14 ↔ D01, D02 | D14s Owner-Schritt pushte Migrationen ohne Dry-Run; von einem Branch aus hätte das D01s Bucket-Migration vor dessen Vercel-READY einspielen können. | D14 „Manuelle Schritte“ 1: Dry-Run, Zeitstempel-Regel und `--include-all` wie in D01 B3. |
| mehrere | Falsche Querverweise, die die Reihenfolge verzerrt hätten: D01 (D03 setzt AUD-197 **nicht** um), D02 und D05 (D03 ändert `hangar.service.ts` nicht), D02 (D06 ändert `hangar.service.ts` nicht), D06 (D02 filtert `fetchCurrentBuild` nicht), D10 (D01 ändert `news-thumb.component.ts` nicht), D18 (`telemetry-stats.component.ts` ändert nur D05). | Jeweils die Zeile in „Abhängigkeiten“ bzw. „Bewusst nicht Teil“. |

### 4b. Überschneidungen mit inhaltlicher Regel (mehr als Rebase)

| Datei oder Baustein | Pläne | Regel |
|---|---|---|
| `src/app/core/edge-error.ts`, `settings.component.ts` `deleteAccount()` | D03 → D05 | Siehe 4a. D03 vor D05. |
| `src/app/codex/codex.service.ts` (`buildsForChannel`, `recentLiveBuilds`, `fetchCurrentBuild`, `armorRating`) | D02, D05 → D06 (Specs D16) | Filter `finalized_at` an allen Build-Listen (D02); `{ builds, failed }` und `recentLiveBuildsOrThrow` (D05); `readCurrentLiveBuild()` und `ArmorRatingResult` (D06). `fetchCurrentBuild` bleibt bei `is_current`. |
| `src/app/hangar/hangar.service.ts` (`pinShip`, `activateConfig`, alle `error.set`) | D02, D05 | D02s zweiter Fehlschlag läuft über `toErrorKey`, wenn D05 zuerst da ist. |
| `src/app/core/deadline.ts` (`READ_RPCS`) | D06 → D14 | Siehe 4a. |
| `admin-feedback.component.ts` `refresh()`/`loadThreads` | D05 → D14 (dazu D01 `render()`) | `threadsStale` aus D05 bleibt im Legacy-Pfad von D14. |
| `supabase/functions/ingest-telemetry/index.ts` | D01 → D02 | D01 ersetzt Zeilen 46–47 (Secrets), D02 Zeile 176 (`capDetail`); beide Änderungen behalten. |
| `supabase/functions/ingest-skins/_r2.ts` | D12 → D13 | D12 setzt die R2-Fristen, D13 schreibt `fetchUsage` zu `readUsage` um und übernimmt die Frist. |
| Migrationen unter `supabase/migrations/` | D01 (2 Dateien), D02 (1), D14 (1); D18 ändert zwei Kommentarköpfe | Zeitstempel nach D01 B3; jeder Owner-Push mit Dry-Run; D01 erst nach Vercel READY. |
| `codex-detail.component.ts` | D05, D11, D14 → D16 (Specs) → D17 → D09, D15 | D17 erst nach D05, D11, D16 PR 1 + Schritt 6; D09 und D15 danach. CSS-Budget siehe 4a. |
| `scripts/check-native-ui.mjs` | D03 → D08 | D08 erweitert die Musterliste. |
| Input `title` → `stageTitle` an `sc-codex-stage` | D07 → D08 | D08 Schritt 7 prüft nur noch. |
| `.sc-sr-only` in `src/styles.scss` | D07 → D08, D18 | D08 und D18 haben Ersatzwege, falls D07 fehlt. |
| `.state.err` in der Schnellsuche | D05, D11 | Wer zuerst mergt, legt die Regel an. |
| Neu angelegte Specs, die mehrere Pläne „neu“ nennen | `quick-search.component.spec.ts` (D05, D11, D16), `hangar-ship-detail.component.spec.ts` (D05, D16), `desktop-auth.component.spec.ts` (D01 → D16), `admin.component.spec.ts` (D16, dazu Fälle aus D14 und D18) | Wer später kommt, erweitert die vorhandene Datei. |
| Uploader-i18n, `public/i18n/{es,fr,pt,ru,zh}.json` | D13 → D18 | Siehe 4a. |
| `prebuild`-Guards in `package.json` | D03 `check-native-ui`, D05 `check-raw-errors`, D15 `check-hover-scope` | Alle drei Befehle behalten. `check-raw-errors` verbietet `console.*` außerhalb `core/log.ts`: gilt für D01 und D14, sobald D05 gemergt ist. |
| `scripts/mobile-gate.mjs`, `docs/mobile-gate.md` | D04 → D16 PR 3, D09 | Verschiedene Funktionen (Browser-Start, `authRedirect`, `input-zoom`); nach allen dreien muss `npm run gate:mobile:selftest` GREEN melden. |
| `.claude/deep-knowledge/supabase.md`, `storage.md` | D01 → D02 → D18 | D18 schreibt `supabase.md` neu und übernimmt die Zeilen aus D01/D02 sowie D14s Migration. |
| `README.md` | D04 → D18 | D18s Neufassung übernimmt D04s Node-Zeile und `npm run lint`. |
| `.claude/skills/ship/SKILL.md` | D19 → D04 | D04 hängt eine neue Projektregel an; hat D19 dort schon einen nummerierten Punkt ergänzt, die nächste freie Nummer nehmen. |

### 4c. Dateien in mehreren Plänen, nur Rebase

Reihenfolge in Wellen-Reihenfolge. D15s Hover-Codemod fasst zusätzlich fast jede Komponente mit `:hover` an (rund 90 Dateien); weil D15 zuletzt läuft, ist das dort nur ein erneuter Codemod-Lauf auf frischem main.

| Datei | Pläne |
|---|---|
| `package.json` | D04, D01, D03, D12 → D05 → D16 → D18 → D15 (Scripts, `engines`, `prebuild`, `description`; alle Zeilen behalten) |
| `public/i18n/de.json`, `en.json` | D01, D03, D10 → D05, D07 → D06, D11, D14 → D18 (D18 prüft zuletzt Parität und tote Schlüssel) |
| `src/styles.scss` | D03 → D07 → D09 → D15 |
| `CLAUDE.md` | D04 (Commands), D10 („Red means …“) → D15 (Motion-Regel); optional D05 (Owner-Schritt) |
| `docs/feedback-routine.md` | D01 (Appendix-Zeile), D04 (Verify-Zeilen) |
| `src/app/admin/admin.component.ts` | D03 → D05, D07 → D08, D14 → D09, D18 → D15 |
| `src/app/admin/feedback/admin-feedback.component.ts` | D01, D03 → D05, D07 → D08, D14 → D09 → D15 |
| `src/app/admin/api-tokens/api-tokens.component.ts` | D03 → D05, D07 → D09; `api-tokens.service.ts`: D05 → D06 |
| `src/app/settings/settings.component.ts` | D03 → D05, D07 → D08 → D09 → D15 |
| `src/app/hangar/hangar-ship-detail.component.ts` | D03 → D05 → D08, D14 → D09 |
| `src/app/hangar/hangar-dashboard.component.ts`, `hangar-item-picker.component.ts` | D05 → D08 → D09 |
| `src/app/hangar/hangar-import.component.ts` | D05 → D08 → D18 |
| `src/app/codex/holo/codex-holo-stage.component.ts` | D05 → D11, D14 → D17 → D09 → D15 |
| `src/app/codex/ship-skin-viewer.component.ts` | D05 → D06, D11, D14 → D15 |
| `src/app/codex/codex-landing.component.ts` | D05, D07 → D06, D08 → D09 → D15 |
| `src/app/codex/codex-patch-headline.component.ts` | D05 → D06, D08, D11 |
| `src/app/codex/codex-list.component.ts`, `fps-list.component.ts` | D05 → D06 → D09 → D15 (Specs zusätzlich D16) |
| `src/app/codex/codex-swap-picker.component.ts` | D10 → D05 → D08 → D09 → D15 |
| `src/app/codex/codex-bridge.component.ts`, `upcoming-grid.component.ts` | D05 → D08 → D09 → D15 |
| `src/app/codex/keybinds.component.ts` | D05 → D14 → D09 |
| `src/app/codex/set/codex-set.component.ts` | D05 → D06 (Spec zusätzlich D07, D16) |
| `src/app/codex/set/codex-set-rank-card.component.ts` | D07 → D06 → D15 |
| `src/app/codex/codex-board-figure.component.ts` | D05 → D06 → D15 |
| `src/app/codex/codex-kpi-band.component.ts` | D10 → D07 → D15 |
| `src/app/codex/holo/codex-holo-strip.component.ts` | D10 → D07 → D09 → D15 |
| `src/app/codex/holo/codex-holo-patch.component.ts` | D05 → D11 → D15 |
| `src/app/codex/holo/codex-holo-inspector.component.ts` | D08, D11 → D15 |
| `src/app/codex/holo/codex-holo-share.component.ts` | D05 → D11 |
| `src/app/codex/codex-analysis-panels.component.ts` | D08, D11 |
| `src/app/codex/detail/codex-ship-stage.component.ts` | D14 → D17 → D15 |
| `src/app/news/news-list.component.ts` | D10 → D05, D07 → D18 → D15 |
| `src/app/news/patch-board.component.ts` | D05 → D08, D11 → D09 → D15 |
| `src/app/news/patch-dossier.component.ts` | D07 → D08 → D09 → D15 |
| `src/app/shell/quick-search.component.ts` | D05, D07 → D11 → D09 → D15 |
| `src/app/shell/shell.component.ts` | D10 → D07 → D09 → D15 |
| `src/app/shell/feedback-fab.component.ts`, `user-feedback-fab.component.ts` | D08 → D09 → D15 |
| `src/app/starscape/starscape.component.ts` | D05, D07 → D08 → D15 |
| `src/app/desktop/desktop-download.component.ts`, `uploader-access.component.ts` | D05, D07 → D08 |
| `src/app/desktop/app-download-menu.component.ts` | D05 → D08, D11 |
| `src/app/desktop/desktop-auth.component.ts` | D01 → D05 (Spec D01 → D16) |
| `src/app/p4k/p4k-history.component.ts` | D03 → D05, D07 → D15 |
| `src/app/feedback/user-feedback-panel.component.ts` | D01 → D05 → D15 |
| `src/app/auth/auth.service.ts` | D05 → D06 |
| `src/app/auth/login.component.ts`, `set-password.component.ts` | D10 (Kommentar), D05 → D09 |
| `src/app/app.component.ts` | D11 → D09 (Spec D11 → D16) |
| `src/index.html` | D14 → D09 |
| `data-uploader/src/i18n/de.json`, `en.json` | D13 → D18 |

## 5. Nur du

Alles, was eine Session nicht kann: Projektzugang, Secrets, Tags, Geräte, Entscheidungen. Nach Zeitpunkt geordnet und zusammengelegt.

### Sofort, unabhängig von den Plänen

1. **Fehlender Release-Tag aus 0.104.0** (Cloud-Sessions können keine Tags pushen, dotclaude#566). Aus dem lokalen Checkout:

   ```bash
   git fetch origin main
   git tag -a alpha/v0.104.0 -m "alpha/v0.104.0" 0bddf2112036bb5a82a5e3d718a098e65531fc96 && git push origin alpha/v0.104.0
   git ls-remote --tags origin alpha/v0.104.0
   ```

   Auch künftige `alpha/v…`-Tags setzt du, solange dotclaude#566 offen ist.
2. Die Entscheidungen aus Abschnitt 6 treffen, am besten bevor der jeweilige Plan startet.

### Regeln für jeden Merge

- **Edge Functions:** Jeder Merge, der `supabase/functions/` berührt (D01, D02, D05, D12, D13, D18, D04 für `ship-link`), deployt über den Workflow. Danach `gh run list --workflow=edge-functions-deploy.yml -L 1` muss grün sein. Scheitert er: `npx supabase functions deploy <slug> --project-ref hcnqhvzlavdycidqyaai`.
- **Migrationen (D01, D02, D14):** vor jedem Push `npm run db:push -- --dry-run`. Die Vorschau darf nur die Dateien des gerade behandelten Plans zeigen. Meldet `db push` „inserted before the last migration on remote“: vor dem Merge die Datei auf einen neuen Zeitstempel umbenennen, nach dem Merge `npm run db:push -- --include-all`.

### Welle 0: D19

1. **Direkt nach dem Merge und vor dem nächsten Routine-Tick** (Desktop-Gegenprobe): im primären Checkout `git pull` auf main, in der Desktop-App eine neue **interaktive** Session starten und eine Abfrage zum Marketplace `dotclaude` bestätigen. `/plugin` zeigt `devops` genau einmal, `/hooks` jeden devops-Hook genau einmal. Im Zweifel die Feedback-Routine bis dahin pausieren. Den nächsten Tick beobachten: Er startet mit der Gate-Zeile.
2. **Cloud-Prüfung:** auf claude.ai/code eine neue Session auf `StarOrga/Star-Citizen-Companion-Web` (main) starten. `/plugin` zeigt `devops` aus `dotclaude`; die Werkzeuge `mcp__plugin_devops_dotclaude-ship__*` inklusive `ship_release` sind da; eine Vertrauensabfrage für den Marketplace bestätigen.

### Welle 1: D04, D01, D12, D10

1. **D04, nach dem ersten grünen `web-ci`-Lauf:** in GitHub → Settings → Rules → Rulesets (Regel für `main`) die vier Checks als Pflicht markieren: `does this touch the web app`, `typecheck · lint · gate scripts · worker tests`, `unit tests (Karma)`, `production build + mobile gate`. Optional `which functions does this touch`.
2. **D04:** Im Vercel-Preview des PRs → Build Logs steht Node 24.x. Steht dort 22.x: in Vercel Settings → Build and Deployment → Node.js Version 24.x lassen und `engines` auf `^24.15.0` verengen. Ist das Repo privat: Actions-Minuten im Billing prüfen (grob 10–15 Minuten pro Web-PR).
3. **D04, Entscheidung** (Abschnitt 6): Secrets für den angemeldeten Gate-Lauf. Falls ja: `gh secret set SC_TEST_EMAIL` und `gh secret set SC_TEST_PASSWORD`.
4. **D01, vor dem Merge** (die Function deployt beim Merge automatisch):

   ```bash
   npx supabase secrets list --project-ref hcnqhvzlavdycidqyaai          # muss TELEMETRY_HMAC_KEY und TELEMETRY_HASH_SALT zeigen
   gh secret list --repo StarOrga/Star-Citizen-Companion-Web             # muss SC_TELEMETRY_HMAC_KEY zeigen
   ```

   - Fehlt `TELEMETRY_HMAC_KEY`: denselben Wert wie das GitHub-Secret `SC_TELEMETRY_HMAC_KEY` setzen, `npx supabase secrets set TELEMETRY_HMAC_KEY=<wert> --project-ref hcnqhvzlavdycidqyaai`. Kennst du ihn nicht: einen neuen Zufallswert (z. B. `openssl rand -hex 32`) an **beiden** Stellen setzen, zusätzlich `gh secret set SC_TELEMETRY_HMAC_KEY --repo StarOrga/Star-Citizen-Companion-Web`. Folge: ausgelieferte Starscape-Builds mit altem Schlüssel werden abgewiesen, bis sie aktualisiert sind.
   - Fehlt `TELEMETRY_HASH_SALT`: `npx supabase secrets set TELEMETRY_HASH_SALT=<zufallswert> --project-ref hcnqhvzlavdycidqyaai`. Folge: Install- und Session-Hashes beginnen neu (Bruch im Dashboard, in der Alpha vertretbar).
5. **D01, nach dem Merge, sobald das Vercel-Deployment des Merge-Commits READY ist** (erst muss die signierende App live sein, dann wird der Bucket privat): vom primären Checkout auf main `npm run db:push -- --dry-run` (genau die zwei D01-Dateien), dann `npm run db:push`.
6. **D01, danach prüfen:**
   - `curl -s -w " HTTP %{http_code}\n" -X POST https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/ingest-telemetry` liefert `{"error":"stale_or_missing_timestamp"} HTTP 401`, nicht `503`. Bei 503 die Secrets setzen; antwortet sie danach weiter mit 503, einmal `npx supabase functions deploy ingest-telemetry --project-ref hcnqhvzlavdycidqyaai`.
   - Eine alte öffentliche Anhang-URL liefert 400/404, im Admin-Board lädt dasselbe Bild.
   - Mit deinem PAT einmal `node scripts/routine-gate.mjs attachment --url "<echte Anhang-URL aus admin_feedback_messages>"`: Die Datei entsteht, im Output steht kein Key.
7. **D12, nach dem Merge:** den Worker deployen (Cloud-Sessions haben keine Cloudflare-Anmeldung).

   ```bash
   cd cloudflare/assets-worker
   npx wrangler@4 login      # nur falls die Anmeldung abgelaufen ist
   npx wrangler@4 deploy
   U=https://sc-assets.sc-assets-worker.workers.dev/ship-skins/DRAK_Cutlass_Black/elysium.webp
   curl -s -o /dev/null -D - -H 'Range: bytes=0-99'       $U | grep -i "^HTTP\|content-range\|accept-ranges"   # 206, bytes 0-99/10898
   curl -s -o /dev/null -D - -H 'Range: bytes=-50'        $U | grep -i "content-range"                         # bytes 10848-10897/10898
   curl -s -o /dev/null -D - -H 'Range: bytes=999999999-' $U | grep -i "^HTTP\|content-range\|access-control-allow-origin"  # 416, bytes */10898, *
   ```

   Dann die Functions: Workflow-Lauf grün für `api`, `fetch-verse-news`, `ingest-skins`, `readme-sync`, `starscape-summary`; `curl -s https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/openapi.json | jq '.servers'` zeigt die Function-URL; `…/functions/v1/fetch-verse-news` (Header `apikey: <Publishable Key aus src/environments/environment.prod.ts>`) antwortet 200; `…/functions/v1/starscape-summary?w=640&h=360` antwortet `200 image/png`. Im Browser `/codex/<ship>`: Hülle und Skin-Icons laden.
8. **D10, im PR:** Logo-Freigabe und Kachelrahmen, siehe Abschnitt 6.

### Welle 2: D02, D05, D13 (mit D01)

1. **D02, vor dem Push:** prüfen, ob gerade ein Import läuft oder abgebrochen ist (ein nicht aktueller Build, der neuer ist als der aktuelle seines Kanals), per Dashboard-SQL: `select channel, patch_version, build_number, is_current, created_at from public.codex_builds order by channel, created_at desc;`. Wenn ja, erst klären: Der einmalige Backfill markiert jeden vorhandenen Build als fertig.
2. **D02, bevorzugt direkt vor dem Merge** (Schritt 9 braucht die neue Spalte):

   ```bash
   git switch fix/d02-db-delete-retention && git pull
   npm run db:push -- --dry-run     # nur <ts>_delete_paths_and_log_retention.sql
   npm run db:push && git switch main
   ```

   Danach per SQL: `select jobname, schedule from cron.job order by jobname;` (vier Jobs), `select count(*) filter (where finalized_at is null) from public.codex_builds;` (0), `select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'p4k_bundles_disabled_by_fkey';` (`ON DELETE SET NULL`). Eine echte Lösch-Probe auf Produktionsdaten nur mit deinem ausdrücklichen OK. Optional (AUD-102, nicht Teil des Plans): `npx supabase gen types typescript --project-id hcnqhvzlavdycidqyaai --schema public > src/app/core/database.types.ts` als eigener Commit.
3. **D05, nach dem Merge:** In `/admin` → Registrieren die Adresse `test@invalid` absenden. Erwartet ist der übersetzte Text aus `admin.register.err.invalid_email`, nicht „invalid email“ und nicht „Edge Function returned a non-2xx status code“ (die Adresse scheitert an der Server-Regex vor jedem Schreibzugriff).
4. **D05, PostHog:** im eigenen Browser Statistik erlauben, auf der Produktionsseite in der Konsole `setTimeout(() => { throw new Error('d05-probe') })`. Im PostHog-EU-Projekt erscheint ein `$exception` mit `$current_url` ohne Query; ist Error Tracking dort aus, einschalten. Optional die Projektregel „Errors go through `toErrorKey()`“ in `CLAUDE.md` aufnehmen (Vorschlag in D05).
5. **Uploader-Release für D01 Schritt 6 und D13** (erst wenn beide gemergt sind, dann trägt **ein** Binary beide Fixes), über `/ship` aus einer lokalen Session: Version in `package.json` **und** `data-uploader/package.json` erhöhen, Tag `data-uploader-v<version>` pushen, CI (`data-uploader-build.yml`) baut und spiegelt, dann das Catalog-Register-SQL aus dem CI-Schritt „Print catalog-register SQL“ ausführen und den `alpha`-Ring darauf zeigen lassen (Details: `.claude/deep-knowledge/data-uploader-release.md`). Danach im Admin-Telemetrie-Dashboard (Produkt „data-uploader“) prüfen, dass Ereignisse ankommen.
6. **D13, mit dem neuen Uploader:** den aktuellen LIVE-Build einmal extrahieren und hochladen (Renegade-Fix). Prüfen:

   ```bash
   K=$(grep -o "sb_publishable_[A-Za-z0-9_]*" src/environments/environment.prod.ts | head -1)
   curl -s "https://hcnqhvzlavdycidqyaai.supabase.co/rest/v1/codex_ships?select=is_variant,build:codex_builds(patch_version,is_current)&class_name=eq.AEGS_Avenger_Titan_Renegade" -H "apikey: $K"
   ```

   Die Zeile mit `"is_current": true` zeigt `"is_variant":false`; `/codex/index` → Schiffe → Suche „Renegade“ findet die Titan Renegade.

### Welle 3: D14 (und optional D06)

1. **D14, bevorzugt vor dem Merge, vom PR-Branch:** `npm run db:push -- --dry-run` (nur `<ts>_admin_feedback_board_delta.sql`), dann `npm run db:push`. Danach `/admin/feedback` öffnen: Network zeigt `rpc/admin_feedback_board_delta` mit 200.
2. **D06, optional nach dem Ship:** auf einem Gerät mit installierter PWA die App einmal online öffnen, dann im Flugmodus neu starten. Die Oberfläche zeigt Texte, keine Schlüssel.

### Wellen 4 bis 7: D16, D17, D09, D18, D15

1. **`npm run gate:mobile:auth` auf deinem Rechner** (Testkonto in der Windows-Anmeldeinformationsverwaltung): nach D16 Schritt 14 (keine der neun `auth.routes` gilt fälschlich als umgeleitet) und nach dem Merge von D17 (`/codex/ship/CNOU_Nomad` ist nur angemeldet erreichbar). Optional mit einem freigeschalteten Nicht-Admin-Konto: `/admin/feedback` erscheint als `auth-redirect → /news`.
2. **D16 Schritt 15**, falls die Session keinen Docker-Zugriff hat: `npm run stack:up`, `npm run db:reset`, `npm run test:db`, `npm run stack:down` (nur lokal).
3. **D09, auf der Preview-URL des PRs, mit einem echten iPhone mit Home-Indikator** (oder Xcode-Simulator; `env(safe-area-inset-bottom)` lässt sich in Chrome nicht emulieren): Schiffsseite mit `?view=holo` (Holotable-Leiste und aufgeklapptes Sheet), Codex-Liste mit zwei Einträgen im Vergleich (Vergleichsleiste), ein Suchfeld antippen: **kein** Hineinzoomen.
4. **D18, nach dem Merge:** kurz auf die Läufe von `readme-docs-sync.yml` und `edge-functions-deploy.yml` (neues `readme-sync/content.ts`) schauen.
5. **D15, optional:** auf einem echten Touch-Gerät eine Hangar-Karte antippen, danach bleibt keine Hebung hängen.

### Entscheidungen außerhalb der Pläne

- AUD-368 (Authenticode-Zertifikat für den Uploader) bleibt deine Kosten- und Zertifikatsentscheidung (D01).
- AUD-316 (Edge Functions `verify-release-token`, `process-p4k`, `check-bundle` ohne Aufrufer): löschen (`npx supabase functions delete <name> --project-ref hcnqhvzlavdycidqyaai`) oder verdrahten, als Issue (D17).
- AUD-043 (zweite Quelle für R2-Hüllen) ist eine Speicher- und Kostenentscheidung, als Issue (D06, D12).

## 6. Offene Fragen an den Owner

Aus den Reviews der Pläne, nur echte Entscheidungen. In Klammern der Default, mit dem die Session arbeitet, wenn keine Antwort kommt.

1. **D01:** `src/app/desktop/desktop-read-auth.component.ts` (`/desktop/connect`) übergibt Token nach demselben Auto-Submit-Muster wie AUD-170, ist aber kein Befund dieses Blocks. Soll der Bestätigungsklick aus Schritt 8 dort im selben PR mit rein, oder erst bei der Zusammenlegung der beiden Komponenten (AUD-282/304, Issue nach D17)? (Default: nicht anfassen.)
2. **D04:** Sollen `SC_TEST_EMAIL`/`SC_TEST_PASSWORD` als Actions-Secrets für den angemeldeten Gate-Lauf gesetzt werden? Das Testkonto ist Admin auf Produktion, und Abmelden wirkt global. (Default: nicht setzen, oder ein eigenes freigeschaltetes Nicht-Admin-Konto.)
3. **D07:** Im API-Token-Anzeigedialog: Escape erst nach dem Kopieren wirksam (Schutz vor Token-Verlust), oder sofort schließen, wie Option A und der Fix-Text von AUD-068 sagen? „Verstanden“ schließt in beiden Fällen ohne Kopieren. (Default: erst nach dem Kopieren.)
4. **D08:** Tooltip-Stufe der rund 40 Symbolknöpfe: Label-Stufe (500 ms) nur für ungewöhnliche Symbole und Info-Stufe (1,5 s) für ✕ × ‹ › ← ⋯ ↗ nach Projektregel R1, oder überall Label-Stufe? (Default: R1.)
5. **D09:** AUD-218 (`--sc-font-mono` ist nirgends definiert, eine Zeile) als Beifang-Commit in D09 oder ins Sammel-Issue? (Default: Sammel-Issue.)
6. **D10:** Video-Kacheln: Rahmen neutral (Rot ganz weg) oder YouTube-Rot `#ff0000` als dokumentierte Markenfarbe, nie `--sc-danger`? (Default: neutral.)
7. **D10:** Freigabe, dass die Seite das Original-YouTube-Icon (YouTube Brand Guidelines) und die Spectrum-Marke (CIG/RSI-Fan-Richtlinien) zeigt, und Quelle der Spectrum-SVG. (Default: bis zur Freigabe bleibt für Spectrum der neutrale Headset-Glyph.)
8. **D14:** Schritt 8 (AUD-221, eine Poll-Schleife statt vier in der Nutzerverwaltung) stammt aus dem Optionstitel „Plus Admin-Polling“, nicht aus dem Optionstext. Im PR lassen oder als Issue führen? (Default: als letzter, abtrennbarer Commit im PR.)
9. **D15:** Die Reihenfolge D10 → D17 → D09 → D18 → D15 bestätigen. Ohne D17 kommt `codex-detail` nicht unter die 18-kB-Warnschwelle; Ausweg wäre, D15 mit der im PR ausgewiesenen Warnung auszuliefern. Das Budget wird nie angehoben. (Default: Reihenfolge wie in Abschnitt 3.)
10. **D16:** Die Entscheidung lautete „alle 21 fehlenden Spec-Dateien plus die REQ-Prüfungen“; der Plan macht daraus bis zu 54 neue Spec-Dateien plus pgTAP-Tests und einen Gate-Fix in drei PRs (PR 1 = Umfang von Option A). Gewollt, oder nach PR 1 bzw. PR 2 stoppen, oder nur die 21 Pfade aus AUD-071? (Default: alle drei PRs.)

## 7. Stand der Befunde

- Das Audit behielt 368 Befunde (dazu NEU-1/NEU-2 aus dem Nachtrag). Release 0.104.0 hat 42 davon vor dem Planen behoben.
- Die Planer haben am 2026-09-28 auf `1b08612` jeden Befund ihres Blocks erneut geprüft. **Keiner der geplanten Befunde war auf main schon vollständig behoben.** 13 waren teilweise erledigt oder beruhten auf einer falschen Annahme:

| Befund | Plan | Stand auf main |
|---|---|---|
| AUD-001 | D08 | teilweise: Holo-Pins, Inspector-`title`, Missionsleiste, Energie-Dock, Speichern-Leiste seit 0.104.0 (`95c29d6`) umgestellt |
| AUD-002 | D08 | teilweise wie AUD-001; „Set-Name“ und „Codex-Start“ sind Component-Inputs, kein natives `title` |
| AUD-278 | D08 | teilweise: `codex-holo-hangar` mit seinem „←“ in 0.104.0 entfernt |
| AUD-151 | D07 | zur Hälfte: `codex-holo-hangar.component.ts` entfernt; offen bleibt der KPI-Knopf ⓘ |
| AUD-111 | D02 | zur Hälfte: der eindeutige Pin-Index existiert seit `20260613000000_hangar.sql:47-49`; offen ist nur die Client-Behandlung von 23505 |
| AUD-046 | D06 | teilweise: die HttpClient-Feeds haben schon `timeout(…)`; offen sind alle Supabase-Reads, Release-Notes und die rohen `fetch`-Aufrufe |
| AUD-093 | D09 | teilweise: das Patch-Dossier nutzt schon `100dvh`; offen sind acht Zeilen in sechs Dateien |
| AUD-212 | D10 | teilweise: Feedback-Panel seit 0.104.0 ohne `--sc-accent-hot`; offen die zwei dekorativen Verläufe |
| AUD-276, AUD-338 | D15 | teilweise: News-Liste und News-Thumbnail haben Hover schon hinter `@media (hover: hover)`; 341 Regeln offen |
| AUD-307 | D16 | teilweise: `swipe-action.directive.ts` samt Spec seit `95c29d6` gelöscht; Holo-Stage und `img-ready` offen |
| AUD-144 | D11 | Fehlbefund: Die fünf relativen String-Redirects behalten Query und Fragment schon; der Plan sichert das nur per Regressions-Spec |
| AUD-362 | D14 | Annahme „render-blockierendes Google-Fonts-Stylesheet“ trifft im Produktions-Build nicht zu (Angular bettet es ein); umgesetzt wird nur „weniger Schriftschnitte“ |

- AUD-127 (fünf 30-ms-Polls in den Guards) reproduziert noch, wird aber durch D06 Schritt 4 miterledigt und ist in D14 deshalb nicht Teil.
- **Neue Nebenbefunde beim Planen** (keine Audit-IDs, jeweils im Plan beschrieben):
  - D08: Der Auto-Fix in 0.104.0 hat am Holo-Inspector den Esc-Hinweis entfernt; D08 Schritt 8 stellt ihn als App-Tooltip wieder her.
  - D10: drei weitere „schlechter“-Deltas in `codex-holo-perspectives` (das Audit-Grep `grep -v spec` hatte die Datei „per**spec**tives“ ausgefiltert).
  - D02: AUD-005 ist größer als beschrieben; auch `owner_user_id` scheitert am Share-Guard.
  - D12: `/functions/v1/api/docs` kommt als `text/plain`, Scalar rendert dort nie (neues Issue).
  - D13: `npm --prefix data-uploader run typecheck` prüft keine einzige Datei (neues Issue).
  - D18: Die `package.json`-Skripte `tool:*` zeigen auf ein nie existierendes `desktop-tool/` (Issue).
- Was jeder Plan bewusst nicht umsetzt, steht dort unter „Bewusst nicht Teil dieses Plans“, jeweils mit Empfehlung (meist ein Issue oder Sammel-Issue).
