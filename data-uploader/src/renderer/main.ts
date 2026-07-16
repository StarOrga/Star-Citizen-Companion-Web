/**
 * Renderer entry — Phase 1 shell.
 *
 * Three views: Discover → Configure → Run. View routing is a simple state
 * machine — no framework yet (keep the bundle tiny). Phase 2 may bring in
 * Lit or Preact if the UI grows.
 */

import { load as loadI18n, setLocale, getLocale, t, type LocaleId } from '../lib/i18n.js';
import type { JobView } from '../main/upload-session.js';
import {
  progressCardHtml,
  mountProgress,
  type ProgressController,
  type ProgressStep,
  type ProgressLabels,
} from './progress.js';

interface ToolEnv {
  toolVersion: string;
  apiBase: string;
  releaseTokenFingerprint: string;
  platform: string;
}

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

// Funnel renderer-side failures into the same main.log + crash telemetry as the
// main process. Installed synchronously at module load — before init() runs —
// so an error during startup is still captured. Best-effort: window.sc may be
// briefly undefined only if the preload failed entirely (itself logged there).
function installRendererCrashCapture(): void {
  window.addEventListener('error', (ev) => {
    const err = ev.error instanceof Error ? ev.error : null;
    window.sc?.log?.crash({
      name: err?.name ?? 'Error',
      message: err?.message ?? String(ev.message ?? 'unknown renderer error'),
      stack: err?.stack ?? null,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const err = reason instanceof Error ? reason : null;
    window.sc?.log?.crash({
      name: err?.name ?? 'UnhandledRejection',
      message: err?.message ?? String(reason),
      stack: err?.stack ?? null,
    });
  });
}
installRendererCrashCapture();

type ViewName = 'discover' | 'configure' | 'run' | 'auth-upload';
type LogLevel = 'info' | 'success' | 'warn' | 'error';

interface SkinShipResult {
  ship_id: string;
  export_dir: string;
  skins: { skin_id: string; name: string; has_model: boolean; has_icon: boolean }[];
}

// Plain-text mirror of the run-view log stream, so the "copy" button can hand
// the whole transcript to the clipboard regardless of per-line DOM coloring.
let extractLogText = '';

interface ExtractResultPayload {
  channel: string;
  patch_version: string;
  build_number: string;
  schema_version: number;
  quality_score: number;
  entity_counts: Record<string, number>;
  manifest_path: string;
  output_dir: string;
  tool_version: string;
}

// Logical display order for entity counters (run view + upload summary).
// Reference data first (strings, manufacturers), then the ship → component →
// weapon → ammunition → blueprint chain, with the records_total meta count last.
// Keys not listed fall to the end alphabetically, so a future extractor counter
// still shows up (just unsorted) instead of silently vanishing.
const COUNTER_ORDER = [
  'strings',
  'manufacturers',
  'ships',
  'vehicles',
  'skins',
  'components',
  'items',
  'weapons',
  'ammunition',
  'blueprints',
  'records_total',
] as const;

function orderedCounts(counts: Record<string, number>): [string, number][] {
  const rank = (k: string): number => {
    const i = (COUNTER_ORDER as readonly string[]).indexOf(k);
    return i === -1 ? COUNTER_ORDER.length : i;
  };
  return Object.entries(counts).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

// `t()` returns the key itself when a string is missing — so for the dynamic
// extractor keys (phase / stage / counter names that the Python side invents)
// fall back to the bare key instead of leaking "run.counter.foo" into the UI.
function tOr(key: string, fallback: string, params: Record<string, string | number> = {}): string {
  const v = t(key, params);
  return v === key ? fallback : v;
}
const phaseLabel = (p: string): string => tOr(`run.phase.${p}`, p);
const stageLabel = (s: string): string => tOr(`run.stage.${s}`, s);
const counterLabel = (k: string): string => tOr(`run.counter.${k}`, k);

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const state = {
  view: 'discover' as ViewName,
  // Auto-scan runs once on app start; returning to the Discover view keeps the
  // prior results (and any manually-added folders) instead of re-scanning.
  scanning: false,
  scanned: false,
  channels: [] as Array<{
    channel: string;
    installPath: string;
    dataP4kPath: string;
    version: string | null;
    sizeBytes: number;
    source: string;
    selected: boolean;
  }>,
  profile: 'standard' as 'minimal' | 'standard' | 'maximum' | 'auto',
  // When set on the Configure screen, a successful extraction flows straight
  // into the upload (no manual "Upload anbieten" click) — for unattended runs.
  autoUpload: false,
  lastResult: null as ExtractResultPayload | null,
  // Flips true the moment the extract finishes OK — drives the clear
  // "Bundle fertig, du kannst hochladen" affordance on the Run screen.
  extractDone: false,
  authToken: null as string | null,
  // 3D-livery build result from the upload step (skins ride along the normal
  // extract → upload flow — no separate view).
  skinResult: null as SkinShipResult[] | null,
  // Portable-only "a newer version is available" hint, shown on the Discover
  // (first) screen only and dismissible for the session.
  manualUpdate: null as { currentVersion: string; latestVersion: string } | null,
  manualUpdateDismissed: false,
  // Mirrors the durable upload job owned by the main process. Only a display
  // cache — the file under userData is the source of truth, which is what lets
  // an upload resume after the app is closed or killed.
  uploadPaused: false,
  resumableJob: null as JobView | null,
};

async function init(): Promise<void> {
  await loadI18n();
  applyBranding();
  const env = await window.sc.env();
  paintEnv(env);

  const select = $('#lang-select') as HTMLSelectElement | null;
  if (select) {
    select.value = getLocale();
    select.addEventListener('change', async () => {
      await setLocale(select.value as LocaleId);
      render();
      paintConnection();
    });
  }

  void initTelemetryToggle();

  // Auto-update banner — subscribe + paint last known status (no-op on dev).
  window.sc.update.onEvent(onUpdateEvent);
  void window.sc.update.status().then(onUpdateEvent);

  // Web-connection tile — auto-connect (persisted session) + auto-sync.
  void initConnectionTile();

  // Re-validate the session whenever the operator returns to the window — the
  // web app may have been redeployed in the background, invalidating the login.
  // `force` bypasses the throttle since a focus event is a deliberate return.
  window.addEventListener('focus', () => void revalidateSession(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void revalidateSession(true);
  });

  render();
}

// ============= Web-connection tile (persistent across all views) =============

interface ConnChannelState {
  channel: string;
  patchVersion: string;
  buildNumber: string;
  qualityScore: number | null;
  entityTotal: number;
  bundleId: string;
  createdAt: string;
}
interface ConnSnapshot { syncedAt: number; channels: ConnChannelState[]; bundleCount: number }
interface ConnSyncProgress { phase: string; pct: number; message?: string; channel?: string }
interface ConnStatus {
  connected: boolean;
  email: string | null;
  expiresAt: number | null;
  canPersist: boolean;
  needsReconnect: boolean;
}

const conn = {
  status: null as ConnStatus | null,
  snapshot: null as ConnSnapshot | null,
  syncing: false,
  syncPct: 0,
  syncPhase: '',
  error: null as string | null,
  resolved: false,
};

async function initConnectionTile(): Promise<void> {
  // 1. Instant paint from the remembered snapshot — no network ("Fortschritt gemerkt").
  try {
    conn.snapshot = (await window.sc.sync.cached()) as ConnSnapshot | null;
  } catch {
    /* cache optional */
  }
  paintConnection();

  // 2. Live sync-progress subscription — parts build up on the tile.
  window.sc.sync.onEvent((ev: ConnSyncProgress) => {
    conn.syncing = ev.phase !== 'done' && ev.phase !== 'error';
    conn.syncPct = ev.pct;
    conn.syncPhase = ev.phase;
    if (ev.phase === 'error') conn.error = ev.message ?? 'sync_failed';
    paintConnection();
  });

  // 3. Resolve session + auto-connect/sync without user interaction.
  await refreshConnection();
}

async function refreshConnection(): Promise<void> {
  try {
    conn.status = (await window.sc.session.status()) as ConnStatus;
  } catch {
    conn.status = { connected: false, email: null, expiresAt: null, canPersist: true, needsReconnect: false };
  }
  conn.resolved = true;
  paintConnection();
  if (conn.status?.connected) {
    // Mirror the token into the upload/skin flows so they skip the re-login.
    try {
      const tok = await window.sc.session.token();
      if (tok.token) state.authToken = tok.token;
    } catch {
      /* ignore */
    }
    void autoSync();
  }
}

async function autoSync(): Promise<void> {
  if (conn.syncing) return;
  conn.syncing = true;
  conn.error = null;
  paintConnection();
  try {
    const r = await window.sc.sync.start();
    if (r.ok && r.snapshot) conn.snapshot = r.snapshot as ConnSnapshot;
    else if (!r.ok) conn.error = r.error ?? 'sync_failed';
  } catch (e) {
    conn.error = (e as Error).message;
  } finally {
    conn.syncing = false;
    paintConnection();
  }
}

// Lightweight session re-check — detects a session that went stale WHILE the
// app was open (e.g. the web app was redeployed and the operator must
// re-authorise) so the "Sitzung abgelaufen" pill appears proactively, instead
// of the failure only surfacing as an error the moment Upload is pressed.
// Unlike refreshConnection() this NEVER kicks off a full catalog sync — it only
// refreshes the connection pill. Throttled so focus/navigation churn is cheap.
const SESSION_REVALIDATE_THROTTLE_MS = 30_000;
let lastSessionRevalidateAt = 0;

async function revalidateSession(force = false): Promise<void> {
  if (!conn.resolved) return; // initial resolve owns the first status fetch
  const now = Date.now();
  if (!force && now - lastSessionRevalidateAt < SESSION_REVALIDATE_THROTTLE_MS) return;
  lastSessionRevalidateAt = now;
  let next: ConnStatus;
  try {
    next = (await window.sc.session.status()) as ConnStatus;
  } catch {
    return; // transient failure — keep the last known pill rather than flapping
  }
  const was = conn.status?.connected ?? false;
  conn.status = next;
  if (!next.connected) state.authToken = null; // force a fresh token on next upload
  paintConnection();
  // Only just discovered the session died → also refresh the auth-upload
  // warning if that view is currently showing.
  if (was && !next.connected && state.view === 'auth-upload') paintReconnectNotice();
}

async function connectNow(): Promise<void> {
  conn.error = null;
  setConnBusy(true);
  try {
    const r = await window.sc.authenticate();
    if (r.ok && r.accessToken) {
      state.authToken = r.accessToken;
      await refreshConnection();
    } else {
      conn.error = r.error ?? (t('session.connectFailed', {}) || 'Anmeldung fehlgeschlagen');
      paintConnection();
    }
  } finally {
    setConnBusy(false);
  }
}

async function signOutNow(): Promise<void> {
  try {
    await window.sc.session.signOut();
  } catch {
    /* ignore */
  }
  state.authToken = null;
  conn.status = {
    connected: false,
    email: null,
    expiresAt: null,
    canPersist: conn.status?.canPersist ?? true,
    needsReconnect: false,
  };
  paintConnection();
}

// Prefer the persisted/refreshed session token (no re-login); fall back to an
// interactive browser login only when there is no usable session.
async function ensureUploadToken(): Promise<string | null> {
  try {
    const tok = await window.sc.session.token();
    if (tok.token) {
      state.authToken = tok.token;
      return tok.token;
    }
  } catch {
    /* fall through to interactive login */
  }
  const r = await window.sc.authenticate();
  if (r.ok && r.accessToken) {
    state.authToken = r.accessToken;
    void refreshConnection();
    return r.accessToken;
  }
  return null;
}

function setConnBusy(busy: boolean): void {
  const btn = $('#conn-connect') as HTMLButtonElement | null;
  if (btn) btn.disabled = busy;
}

function relTime(unixSeconds: number): string {
  const deltaSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  if (deltaSec < 60) return t('sync.justNow', {}) || 'gerade eben';
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return t('sync.minutesAgo', { n: String(mins) }) || `vor ${mins} Min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('sync.hoursAgo', { n: String(hours) }) || `vor ${hours} Std`;
  const days = Math.floor(hours / 24);
  return t('sync.daysAgo', { n: String(days) }) || `vor ${days} Tg`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

function connErrorText(code: string): string {
  if (code === 'reconnect') return t('session.expiredHint', {}) || 'Sitzung abgelaufen — bitte neu verbinden.';
  if (code === 'not_connected') return t('session.offline', {}) || 'Nicht verbunden.';
  if (code === 'sync_failed') return t('sync.failed', {}) || 'Sync fehlgeschlagen.';
  return code;
}

function paintConnection(): void {
  const mount = $('#connection-tile');
  if (!mount) return;
  const s = conn.status;
  const snap = conn.snapshot;

  let pillCls = 'offline';
  let pillText = t('session.offline', {}) || 'Nicht verbunden';
  if (!conn.resolved) {
    pillCls = 'pending';
    pillText = t('session.checking', {}) || 'Prüfe…';
  } else if (s?.connected) {
    pillCls = 'online';
    pillText = t('session.connected', {}) || 'Verbunden';
  } else if (s?.needsReconnect) {
    pillCls = 'warn';
    pillText = t('session.expired', {}) || 'Sitzung abgelaufen';
  }

  let identity = '';
  if (s?.connected) {
    identity = `
      <div class="conn-id">
        <span class="conn-email">${escapeHtml(s.email ?? '')}</span>
        <button id="conn-signout" type="button" class="conn-link">${t('session.signOut', {}) || 'Abmelden'}</button>
      </div>`;
  } else if (conn.resolved) {
    const label = s?.needsReconnect
      ? t('session.reconnect', {}) || 'Neu verbinden'
      : t('session.connect', {}) || 'Mit Web verbinden';
    const hint = s?.needsReconnect
      ? t('session.expiredHint', {}) || 'Deine gespeicherte Sitzung ist abgelaufen.'
      : t('session.connectHint', {}) || 'Einmal anmelden — bleibt danach automatisch verbunden.';
    identity = `
      <div class="conn-id">
        <span class="conn-hint">${hint}</span>
        <button id="conn-connect" type="button" class="btn btn-primary btn-sm">${label}</button>
      </div>`;
  }

  let syncRow = '';
  if (conn.syncing) {
    syncRow = `
      <div class="conn-sync">
        <div class="conn-sync-head">
          <span>${t('sync.syncing', {}) || 'Synchronisiere Server-Stand…'}</span>
          <span class="conn-pct">${conn.syncPct}%</span>
        </div>
        <div class="progress-bar"><span style="width:${conn.syncPct}%"></span></div>
      </div>`;
  } else if (snap) {
    const chips = snap.channels
      .map(
        (c) =>
          `<span class="conn-chip ${escapeHtml(c.channel)}"><strong>${escapeHtml(c.channel.toUpperCase())}</strong> v${escapeHtml(c.patchVersion)} · ${c.entityTotal.toLocaleString()}</span>`,
      )
      .join('');
    const refresh = s?.connected
      ? ` · <button id="conn-sync" type="button" class="conn-link">${t('sync.refresh', {}) || 'Aktualisieren'}</button>`
      : '';
    syncRow = `
      <div class="conn-sync">
        <div class="conn-sync-head">
          <span>${t('sync.serverState', {}) || 'Server-Stand'}</span>
          <span class="conn-meta">${t('sync.lastSynced', { when: relTime(snap.syncedAt) }) || `aktualisiert ${relTime(snap.syncedAt)}`}${refresh}</span>
        </div>
        <div class="conn-chips">${chips || `<span class="conn-empty">${t('sync.empty', {}) || 'Noch keine Bundles auf dem Server.'}</span>`}</div>
      </div>`;
  } else if (s?.connected) {
    syncRow = `<div class="conn-sync"><span class="conn-meta">${t('sync.idle', {}) || 'Bereit zu synchronisieren.'}</span></div>`;
  }

  const persistNote =
    s && !s.canPersist
      ? `<div class="conn-persist-note">${t('session.noPersist', {}) || 'Hinweis: Kein OS-Schlüsselspeicher — Sitzung gilt nur bis zum Schließen.'}</div>`
      : '';

  const errorRow = conn.error ? `<div class="conn-error">${escapeHtml(connErrorText(conn.error))}</div>` : '';

  mount.innerHTML = `
    <div class="conn-card">
      <div class="conn-top">
        <span class="conn-title">${t('session.title', {}) || 'Web-Verbindung'}</span>
        <span class="conn-pill ${pillCls}">${pillText}</span>
      </div>
      ${identity}
      ${syncRow}
      ${persistNote}
      ${errorRow}
    </div>
  `;

  $('#conn-connect')?.addEventListener('click', () => void connectNow());
  $('#conn-signout')?.addEventListener('click', () => void signOutNow());
  $('#conn-sync')?.addEventListener('click', () => void autoSync());
}

type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string; releaseDate?: string; notes?: string | null }
  | { type: 'not-available'; currentVersion: string }
  | { type: 'progress'; pct: number; bytesPerSecond?: number; transferred?: number; total?: number }
  | { type: 'downloaded'; version: string }
  | { type: 'manual'; currentVersion: string; latestVersion: string }
  | { type: 'error'; message: string };

// Public download page — opened for portable builds that can't self-update.
// window.open is intercepted by the main process' setWindowOpenHandler and
// routed through shell.openExternal (opens in the default browser, no in-app window).
const DOWNLOAD_PAGE_URL = 'https://sc-companion.vercel.app/desktop';

// Update checks ride on navigation instead of a manual button: every view
// transition (opening the uploader, moving to the next step, …) triggers a
// silent check via render() → maybeAutoCheckUpdate(). No user interaction, no
// error banner — outcomes surface through the auto-update banner / manual hint.
const AUTO_UPDATE_CHECK_THROTTLE_MS = 2 * 60 * 1000;
let lastAutoUpdateCheckAt = 0;
// Mirrors the last event type seen via onUpdateEvent, so navigation checks can
// skip while an update is already checking/downloading/staged.
let lastUpdateType: UpdateEvent['type'] | null = null;

function maybeAutoCheckUpdate(): void {
  if (lastUpdateType === 'checking' || isUpdateBusyType(lastUpdateType)) return;
  const now = Date.now();
  if (now - lastAutoUpdateCheckAt < AUTO_UPDATE_CHECK_THROTTLE_MS) return;
  lastAutoUpdateCheckAt = now;
  window.sc.update.checkSilent();
}

function isUpdateBusyType(type: UpdateEvent['type'] | null): boolean {
  return type === 'available' || type === 'progress' || type === 'downloaded';
}

// Routes update events: the portable 'manual' hint lives on the Discover
// (first) screen only (state + paintManualBanner); every other state uses the
// persistent shell banner.
function onUpdateEvent(ev: UpdateEvent): void {
  lastUpdateType = ev.type;
  if (ev.type === 'manual') {
    state.manualUpdate = { currentVersion: ev.currentVersion, latestVersion: ev.latestVersion };
    state.manualUpdateDismissed = false; // a freshly-published newer version re-shows the hint
    paintManualBanner();
    return;
  }
  paintUpdateBanner(ev);
}

// Markup for the dismissible "new version available" banner on the Discover
// screen. Caller decides whether to render it (state.manualUpdate set + not
// dismissed).
function renderDiscoverUpdateBanner(): string {
  const u = state.manualUpdate;
  if (!u) return '';
  const msg =
    t('update.manual', { version: u.latestVersion }) ||
    `Neue Version v${u.latestVersion} verfügbar — Portable kann sich nicht selbst updaten, bitte manuell laden.`;
  return `
    <div class="discover-update" id="discover-update">
      <span class="discover-update-text">${escapeHtml(msg)}</span>
      <button id="du-download" type="button" class="btn btn-sm">${t('update.openDownload', {}) || 'Download-Seite öffnen'}</button>
      <button id="du-dismiss" type="button" class="discover-update-close" aria-label="${t('common.dismiss', {}) || 'Schließen'}">✕</button>
    </div>`;
}

function wireDiscoverUpdateBanner(): void {
  $('#du-download')?.addEventListener('click', () => void window.open(DOWNLOAD_PAGE_URL));
  $('#du-dismiss')?.addEventListener('click', () => {
    state.manualUpdateDismissed = true;
    $('#discover-update')?.remove();
  });
}

// Inject/remove the Discover banner in place (the manual event usually arrives
// a few seconds after launch, once the user is already on the first screen).
function paintManualBanner(): void {
  const existing = $('#discover-update');
  const show = state.view === 'discover' && !!state.manualUpdate && !state.manualUpdateDismissed;
  if (!show) {
    existing?.remove();
    return;
  }
  if (existing) return; // already visible
  const view = document.querySelector('#app .view');
  if (!view) return;
  view.insertAdjacentHTML('afterbegin', renderDiscoverUpdateBanner());
  wireDiscoverUpdateBanner();
}

function paintUpdateBanner(ev: UpdateEvent): void {
  const banner = $('#update-banner');
  const text = $('#update-banner-text');
  const action = $('#update-banner-action') as HTMLButtonElement | null;
  if (!banner || !text || !action) return;
  banner.classList.remove('update-banner-error');
  action.style.display = 'none';
  action.onclick = null;

  switch (ev.type) {
    case 'checking':
    case 'not-available':
    // 'manual' is handled outside the shell banner — it renders on the Discover
    // (first) screen only, via paintManualBanner / renderDiscover.
    case 'manual':
      banner.classList.add('hidden');
      return;
    case 'available':
      text.textContent =
        (t('update.available', { version: ev.version }) || `Update verfügbar: v${ev.version} — wird im Hintergrund geladen…`);
      banner.classList.remove('hidden');
      return;
    case 'progress':
      text.textContent =
        (t('update.progress', { pct: String(ev.pct) }) || `Update wird geladen: ${ev.pct}%`);
      banner.classList.remove('hidden');
      return;
    case 'downloaded':
      text.textContent =
        (t('update.downloaded', { version: ev.version }) || `Update v${ev.version} bereit — bitte App neu starten.`);
      action.textContent = t('update.install', {}) || 'Jetzt installieren';
      action.style.display = 'inline-flex';
      action.onclick = () => void window.sc.update.install();
      banner.classList.remove('hidden');
      return;
    case 'error':
      text.textContent = (t('update.error', { message: ev.message }) || `Update-Fehler: ${ev.message}`);
      banner.classList.remove('hidden');
      banner.classList.add('update-banner-error');
      return;
  }
}

// Derive the favicon from the single inline header logo so the SCC monogram is
// defined in exactly one place (index.html). Electron windows have no tab strip,
// so this is mostly cosmetic — but it guarantees favicon and header logo can
// never drift apart, and keeps the renderer free of a second logo copy.
function applyBranding(): void {
  const logo = document.querySelector('svg.logo');
  if (!logo) return;
  const svg = new XMLSerializer().serializeToString(logo);
  const href = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  link.href = href;
}

// Telemetry opt-out toggle in the status bar. Crash reporting is ON by default;
// unchecking it disables all telemetry sends (persisted in the main process).
async function initTelemetryToggle(): Promise<void> {
  const box = $('#telemetry-checkbox') as HTMLInputElement | null;
  const label = $('#telemetry-label');
  const wrap = $('#telemetry-toggle');
  if (!box) return;
  if (label) label.textContent = t('telemetry.toggle', {}) || 'Fehlerberichte senden';
  if (wrap) wrap.title = t('telemetry.hint', {}) || 'Sendet anonyme Absturzberichte, um Fehler zu beheben.';
  try {
    const { telemetryEnabled } = await window.sc.settings.get();
    box.checked = telemetryEnabled;
  } catch {
    box.checked = true;
  }
  box.addEventListener('change', () => {
    void window.sc.settings.setTelemetry(box.checked);
  });
}

function paintEnv(env: ToolEnv): void {
  const vtag = $('#version-tag');
  if (vtag) vtag.textContent = `v${env.toolVersion}`;
  const env_line = $('#env-line');
  if (env_line) env_line.textContent = `${env.platform} · ${env.releaseTokenFingerprint}`;
}

function setStatus(msg: string): void {
  const el = $('#status-line');
  if (el) el.textContent = msg;
}

function render(): void {
  const app = $('#app');
  if (!app) return;
  // Every navigation is a natural moment to check for updates + re-validate the
  // session (both throttled), so a stale login is caught before the user acts.
  maybeAutoCheckUpdate();
  void revalidateSession();
  switch (state.view) {
    case 'discover':
      app.innerHTML = renderDiscover();
      wireDiscover();
      break;
    case 'configure':
      app.innerHTML = renderConfigure();
      wireConfigure();
      break;
    case 'run':
      app.innerHTML = renderRun();
      wireRun();
      break;
    case 'auth-upload':
      app.innerHTML = renderAuthUpload();
      wireAuthUpload();
      break;
  }
}

// ============= View: Discover =============

function renderDiscover(): string {
  const updateBanner =
    state.manualUpdate && !state.manualUpdateDismissed ? renderDiscoverUpdateBanner() : '';
  return `
    <div class="view">
      ${updateBanner}
      <h1>${t('discover.title', {}) || 'Star-Citizen-Installations finden'}</h1>
      <p class="view-intro">${t('discover.subtitle', {}) || 'Cascade läuft automatisch: RSI-Launcher → Filesystem-Scan → optional manuell.'}</p>
      <div id="channels-mount" class="view-body"></div>
      <div class="btn-row view-footer" id="discover-next" style="display:none;">
        <button id="btn-to-configure" class="btn btn-primary">${t('discover.next', {}) || 'Weiter → Konfiguration'}</button>
      </div>
    </div>
  `;
}

function wireDiscover(): void {
  wireDiscoverUpdateBanner();
  $('#btn-to-configure')?.addEventListener('click', () => {
    state.view = 'configure';
    render();
  });

  // No "start scan" button: the scan kicks off automatically the first time the
  // Discover view mounts (i.e. on app start). Coming back to this view keeps the
  // earlier results — including any folders the operator added by hand.
  if (!state.scanned && !state.scanning) {
    void autoScan();
  } else {
    paintChannels();
  }
}

async function autoScan(): Promise<void> {
  state.scanning = true;
  paintChannels(); // shows the loading animation in the lower part
  setStatus('discovering…');
  try {
    const found = await window.sc.discover();
    state.channels = found.map((c) => ({ ...c, selected: true }));
    setStatus(`found ${found.length} channel(s)`);
  } catch {
    setStatus('scan failed');
  } finally {
    state.scanning = false;
    state.scanned = true;
    paintChannels();
  }
}

// Big "add a folder" button under the version list — lets the operator pull in
// installs the auto-scan missed (custom drive, moved library, PTU on another disk).
async function addManualFolder(): Promise<void> {
  const folder = await window.sc.pickFolder();
  if (!folder) return;
  const ch = await window.sc.discoverManual(folder);
  if (!ch) {
    setStatus('no Data.p4k in selected folder');
    return;
  }
  if (state.channels.some((c) => c.dataP4kPath === ch.dataP4kPath)) return;
  state.channels.push({ ...ch, selected: true });
  paintChannels();
}

function paintChannels(): void {
  const mount = $('#channels-mount');
  const nextRow = $('#discover-next');
  if (!mount) return;

  // While the auto-scan runs, show a small spinner in the lower part instead of
  // an empty page — no buttons, no "next" row yet.
  if (state.scanning) {
    mount.innerHTML = `
      <div class="scan-loading">
        <span class="spinner" aria-hidden="true"></span>
        <span>${t('discover.scanning', {}) || 'Suche nach Installationen…'}</span>
      </div>`;
    if (nextRow) nextRow.style.display = 'none';
    return;
  }

  const hasChannels = state.channels.length > 0;
  // Found installs render as a horizontal card track; the manual-add tile rides
  // at the end of the same track so "add by hand" is always reachable.
  const cards = state.channels
    .map(
      (c, i) => `
      <label class="channel-card ${c.selected ? 'selected' : ''}" data-card="${i}">
        <div class="channel-card-top">
          <span class="channel-pill ${c.channel}">${c.channel}</span>
          <input type="checkbox" data-idx="${i}" ${c.selected ? 'checked' : ''} />
        </div>
        <span class="channel-name">${c.version ? 'v' + c.version : c.channel + ' (no version)'}</span>
        <span class="channel-path" title="${escapeHtml(c.installPath)}">${escapeHtml(c.installPath)}</span>
        <span class="channel-size">${(c.sizeBytes / 1024 ** 3).toFixed(1)} GB</span>
      </label>
    `,
    )
    .join('');

  const empty = hasChannels
    ? ''
    : `<p class="discover-empty">${t('discover.none', {}) || 'Keine Installation automatisch gefunden — füge rechts einen Ordner manuell hinzu.'}</p>`;

  mount.innerHTML = `
    <div class="channel-track">
      ${cards}
      ${empty}
      <button id="btn-manual" type="button" class="channel-add-card">＋ ${t('discover.addManual', {}) || 'Ordner manuell hinzufügen'}</button>
    </div>
  `;

  mount.querySelectorAll('input[type=checkbox]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number((e.target as HTMLInputElement).dataset['idx']);
      if (!Number.isInteger(idx)) return;
      const ch = state.channels[idx];
      if (ch) {
        ch.selected = (e.target as HTMLInputElement).checked;
        mount.querySelector(`.channel-card[data-card="${idx}"]`)?.classList.toggle('selected', ch.selected);
      }
    });
  });
  $('#btn-manual')?.addEventListener('click', () => void addManualFolder());

  if (nextRow) nextRow.style.display = hasChannels ? 'flex' : 'none';
}

// ============= View: Configure =============

function renderConfigure(): string {
  return `
    <div class="view">
      <h1>${t('configure.title', {}) || 'Profil wählen'}</h1>
      <p class="view-intro">${t('configure.subtitle', {}) || 'Live umschaltbar — du kannst während des Laufs wechseln.'}</p>
      <div class="profiles view-body" id="profiles-mount"></div>
      <label class="auto-upload-toggle" title="${t('configure.autoUploadHint', {}) || 'Lädt das Bundle nach der Extraktion automatisch hoch (nur wenn du bereits verbunden bist).'}">
        <input type="checkbox" id="chk-auto-upload" ${state.autoUpload ? 'checked' : ''} />
        <span>${t('configure.autoUpload', {}) || 'Nach der Extraktion automatisch hochladen'}</span>
      </label>
      <div class="btn-row view-footer">
        <button id="btn-back-discover" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
        <button id="btn-start-run" class="btn btn-primary">${t('configure.start', {}) || 'Extraktion starten'}</button>
      </div>
    </div>
  `;
}

function wireConfigure(): void {
  void renderProfiles();
  ($('#chk-auto-upload') as HTMLInputElement | null)?.addEventListener('change', (e) => {
    state.autoUpload = (e.target as HTMLInputElement).checked;
  });
  $('#btn-back-discover')?.addEventListener('click', () => {
    state.view = 'discover';
    render();
  });
  $('#btn-start-run')?.addEventListener('click', () => {
    state.view = 'run';
    render();
  });
}

async function renderProfiles(): Promise<void> {
  const mount = $('#profiles-mount');
  if (!mount) return;
  const { profiles } = await window.sc.profiles();
  const selectedSize = state.channels
    .filter((c) => c.selected)
    .reduce((sum, c) => sum + c.sizeBytes, 0);
  const lang = getLocale();
  const entries = await Promise.all(
    Object.values(profiles).map(async (p) => {
      const eta = await window.sc.estimate(p.id as 'minimal' | 'standard' | 'maximum' | 'auto', selectedSize);
      const label = (p.label as Record<string, string>)[lang] ?? p.label.en;
      const desc = (p.description as Record<string, string>)[lang] ?? p.description.en;
      const active = p.id === state.profile ? 'active' : '';
      return `
        <div class="profile-pill ${active}" data-profile="${p.id}" tabindex="0" role="button">
          <span class="name">${label}</span>
          <span class="desc">${desc}</span>
          <span class="eta">~ ${eta.formatted}</span>
        </div>`;
    }),
  );
  mount.innerHTML = entries.join('');
  mount.querySelectorAll('.profile-pill').forEach((el) => {
    const select = (): void => {
      state.profile = (el as HTMLElement).dataset['profile'] as typeof state.profile;
      void renderProfiles();
    };
    el.addEventListener('click', select);
    el.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.key === ' ') {
        if (ke.key === ' ') ke.preventDefault();
        select();
      }
    });
  });
}

// ============= View: Run (Phase 1 stub UI) =============

function renderRun(): string {
  return `
    <div class="view">
      <h1>${t('run.title', {}) || 'Extraktion läuft'}</h1>
      <div class="run-grid view-body">
        <section class="card run-main">
          ${progressCardHtml('run-progress', runSteps())}
        </section>
        <section class="card run-log">
          <div class="log-header">
            <span class="log-title">${t('run.logTitle', {}) || 'Protokoll'}</span>
            <button id="btn-copy-log" type="button" class="btn btn-copy">${t('run.copyLog', {}) || 'Kopieren'}</button>
          </div>
          <div class="log-stream" id="log"></div>
        </section>
      </div>
      <p id="run-ready-note" class="run-ready-note" style="display:none;"></p>
      <div class="btn-row view-footer">
        <button id="btn-back-configure" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
        <button id="btn-to-upload" class="btn btn-primary" disabled>${t('run.next', {}) || 'Upload anbieten'}</button>
      </div>
    </div>
  `;
}

// Flip the Run footer into a clear "bundle is ready — upload now" state once the
// extraction succeeds, so the affordance reads as a positive call-to-action
// rather than a button that silently un-disables.
function markBundleReady(): void {
  const btn = $('#btn-to-upload') as HTMLButtonElement | null;
  if (btn) {
    btn.removeAttribute('disabled');
    btn.classList.add('btn-ready');
    btn.textContent = `✓ ${t('run.bundleReadyCta', {}) || 'Bundle fertig — jetzt hochladen'}`;
  }
  const note = $('#run-ready-note');
  if (note) {
    note.textContent = t('run.bundleReady', {}) || 'Extraktion abgeschlossen — das Bundle ist bereit zum Upload.';
    note.style.display = 'block';
  }
}

function wireRun(): void {
  $('#btn-back-configure')?.addEventListener('click', () => {
    state.view = 'configure';
    render();
  });
  $('#btn-to-upload')?.addEventListener('click', () => {
    state.view = 'auth-upload';
    render();
  });
  $('#btn-copy-log')?.addEventListener('click', () => void copyLog());
  void runRealExtract();
}

async function copyLog(): Promise<void> {
  const btn = $('#btn-copy-log') as HTMLButtonElement | null;
  if (!btn) return;
  const reset = (): void => {
    btn.classList.remove('copied', 'copy-failed');
    btn.textContent = t('run.copyLog', {}) || 'Kopieren';
  };
  try {
    await window.sc.clipboard.writeText(extractLogText);
    btn.classList.remove('copy-failed');
    btn.classList.add('copied');
    btn.textContent = t('run.copied', {}) || 'Kopiert ✓';
  } catch {
    btn.classList.remove('copied');
    btn.classList.add('copy-failed');
    btn.textContent = t('run.copyFailed', {}) || 'Fehlgeschlagen';
  }
  setTimeout(reset, 1600);
}

async function runRealExtract(): Promise<void> {
  const logEl = $('#log');
  const progress = mountProgress('run-progress', {
    counterLabel,
    steps: runSteps(),
    labels: progressLabels(),
  });
  const appendLog = (msg: string, level: LogLevel = 'info') => {
    const prefix = level === 'error' ? '[err] ' : level === 'warn' ? '[warn] ' : '';
    const text = prefix + msg;
    extractLogText += text + '\n';
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'log-line log-' + level;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };
  const countMap: Record<string, number> = {};

  progress.start();
  extractLogText = '';

  const channel = state.channels.find((c) => c.selected);
  if (!channel) {
    appendLog('Kein Channel ausgewählt — zurück zur Discover-Seite.', 'error');
    return;
  }

  // Per-tool extract-output dir — Electron's app.getPath('userData') would
  // be cleaner; for now use a sibling of the install path.
  const outDir = `${channel.installPath}/.sc-companion-extracts/${channel.channel}-${channel.version ?? 'unknown'}`;

  appendLog(`extracting ${channel.dataP4kPath}`);
  appendLog(`output → ${outDir}`);

  const unsubscribe = window.sc.extract.onEvent((ev) => {
    switch (ev.type) {
      case 'phase': {
        const label = phaseLabel(ev.phase ?? 'unknown');
        const si = RUN_STEP_INDEX[ev.phase ?? ''];
        if (si !== undefined) progress.setStep(si);
        progress.update({ phaseLabel: label, overallPct: ev.pct });
        appendLog(`▶ ${label}`);
        return;
      }
      case 'progress': {
        // Name the two long opaque stages so a multi-minute wait is explained
        // rather than looking hung (they emit pct but no current/total).
        const hint =
          ev.stage === 'open'
            ? t('run.hint.open', {}) || 'Öffne das große Archiv — das dauert einen Moment.'
            : ev.stage === 'datacore'
              ? t('run.hint.datacore', {}) || 'DataCore wird dekomprimiert — kann etwas dauern.'
              : '';
        progress.update({
          overallPct: ev.pct,
          stageLabel: stageLabel(ev.stage ?? ''),
          current: ev.current,
          total: ev.total,
          detail: ev.detail,
          hint,
        });
        return;
      }
      case 'file':
        progress.update({ overallPct: ev.pct });
        if (ev.fileName) appendLog(`  · ${ev.fileName}`);
        return;
      case 'count':
        if (ev.counter) {
          countMap[ev.counter.key] = ev.counter.value;
          const ordered: Record<string, number> = {};
          for (const [k, v] of orderedCounts(countMap)) ordered[k] = v;
          progress.update({ counters: ordered });
        }
        return;
      case 'log':
        appendLog(ev.message ?? '', ev.level ?? 'info');
        return;
      case 'warning':
        appendLog(ev.message ?? 'warning', 'warn');
        return;
      case 'done':
        progress.setStep(5); // past the last phase → all step chips 'done'
        progress.update({ overallPct: 100, phaseLabel: phaseLabel('done'), stageLabel: '', detail: '', indeterminate: false, hint: '' });
        return;
      case 'error':
        progress.update({ indeterminate: false });
        appendLog(ev.message ?? 'extraction error', 'error');
        return;
    }
  });

  try {
    const final = await window.sc.extract.start({
      p4kPath: channel.dataP4kPath,
      outDir,
      channel: channel.channel as 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW',
      patchVersion: channel.version ?? 'unknown',
      buildNumber: '', // unknown from disk; server will treat empty as missing
      scope: {
        hdIcons: state.profile !== 'minimal',
        renderPngs: state.profile === 'maximum',
        componentTree: state.profile !== 'minimal',
      },
      toolVersion: (await window.sc.env()).toolVersion,
    });

    if (final.ok && final.result) {
      state.lastResult = final.result;
      state.extractDone = true;
      const totalEntities = Object.values(final.result.entity_counts)
        .reduce((a, b) => a + b, 0)
        .toLocaleString();
      const elapsed = fmtElapsed(progress.elapsedMs());
      appendLog(
        tOr(
          'run.doneSummary',
          `done — quality ${final.result.quality_score.toFixed(0)}/100, ${totalEntities} entities in ${elapsed}`,
          {
            score: final.result.quality_score.toFixed(0),
            entities: totalEntities,
            time: elapsed,
          },
        ),
        'success',
      );
      markBundleReady();
      // Auto-upload only when the operator opted in AND a session is already
      // live — never trigger an interactive browser login unattended.
      if (state.autoUpload && state.authToken) {
        appendLog(t('run.autoUploading', {}) || 'Auto-Upload aktiv — wechsle zum Upload…', 'info');
        state.view = 'auth-upload';
        render();
        void doStartUpload();
      }
    } else {
      appendLog(final.error ?? 'unknown extraction failure', 'error');
    }
  } finally {
    unsubscribe();
    progress.stop();
    progress.update({ indeterminate: false });
  }
}

// ============= View: Auth-Upload =============

// The 3 sub-flows of one upload run, in the order they actually execute
// (see doUploadAfterAuth) — surfaced as a small stepper on the shared
// progress card so the upload flow reads as a sibling of the Run view.
function uploadSteps(): ProgressStep[] {
  return [
    { key: 'bundle', label: t('upload.steps.bundle', {}) || 'Bundle' },
    { key: 'codex', label: t('upload.steps.codex', {}) || 'Codex' },
    { key: 'skins', label: t('upload.steps.skins', {}) || '3D-Skins' },
  ];
}

// The extract pipeline's fixed phases, surfaced as the same step-chip journey
// the upload flow uses — so both views read as siblings. `phaseLabel` reuses
// the existing run.phase.* i18n keys.
function runSteps(): ProgressStep[] {
  return [
    { key: 'discover', label: phaseLabel('discover') },
    { key: 'plan', label: phaseLabel('plan') },
    { key: 'extract', label: phaseLabel('extract') },
    { key: 'validate', label: phaseLabel('validate') },
    { key: 'bundle', label: phaseLabel('bundle') },
  ];
}
const RUN_STEP_INDEX: Record<string, number> = { discover: 0, plan: 1, extract: 2, validate: 3, bundle: 4 };

// Localized labels for the shared progress meta line (throughput / ETA / stall).
function progressLabels(): Partial<ProgressLabels> {
  return {
    still: t('progress.still', {}) || 'arbeitet noch',
    eta: t('progress.eta', {}) || 'Rest',
    perSec: t('progress.perSec', {}) || '/s',
  };
}

function renderAuthUpload(): string {
  const result = state.lastResult;
  const hasResult = result !== null;
  const counts = hasResult
    ? orderedCounts(result!.entity_counts)
        .map(([k, v]) => `<li><strong>${k}:</strong> ${v.toLocaleString()}</li>`)
        .join('')
    : '<li><em>no extraction yet</em></li>';
  return `
    <div class="view">
      <h1>${t('upload.title', {}) || 'Upload'}</h1>
      <div class="upload-grid view-body">
        <section class="card upload-actions">
          <p>${t('upload.intro', {}) || 'Beim Upload-Start öffnet sich der Browser zum Anmelden. Nach erfolgreichem Login wird das Bundle automatisch hochgeladen.'}</p>
          <div id="reconnect-notice" class="reconnect-notice" style="display:none;"></div>
          <div id="resume-notice" class="reconnect-notice" style="display:none;"></div>
          <div class="btn-row">
            <button id="btn-start-upload" class="btn btn-primary" ${hasResult ? '' : 'disabled'}>${t('upload.start', {}) || 'Upload starten'}</button>
            <button id="btn-pause-upload" class="btn" style="display:none;">${t('upload.job.pause', {}) || 'Pause'}</button>
            <button id="btn-resume-upload" class="btn btn-primary" style="display:none;">${t('upload.job.resumeAction', {}) || 'Upload fortsetzen'}</button>
            <button id="btn-discard-upload" class="btn" style="display:none;">${t('upload.job.discard', {}) || 'Verwerfen'}</button>
          </div>
          ${progressCardHtml('upload-progress', uploadSteps())}
          <p id="auth-status" class="warn" style="margin-top: 10px;"></p>
          <div id="upload-result" style="margin-top: 14px;"></div>
        </section>
        <section class="card upload-summary">
          <h2>${t('upload.bundle', {}) || 'Bundle-Zusammenfassung'}</h2>
          ${hasResult
            ? `
            <ul class="bundle-meta">
              <li><strong>channel:</strong> ${result!.channel}</li>
              <li><strong>patch:</strong> ${result!.patch_version}</li>
              <li><strong>build:</strong> ${result!.build_number || '<em>n/a</em>'}</li>
              <li><strong>quality:</strong> ${result!.quality_score.toFixed(0)}/100</li>
            </ul>
            <h3 style="margin-top: 10px;">Entity counts</h3>
            <ul class="entity-strip">${counts}</ul>
          `
            : '<p class="warn">No extraction result — go back and run the extractor first.</p>'}
        </section>
      </div>
      <div class="btn-row view-footer">
        <button id="btn-back-run" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
      </div>
    </div>
  `;
}

// Progress-card controller for the currently-mounted upload view — created
// fresh on every `wireAuthUpload()` (i.e. every time the view is (re)rendered),
// read by the upload sub-flow functions below.
let uploadProgress: ProgressController | null = null;

function wireAuthUpload(): void {
  uploadProgress = mountProgress('upload-progress', {
    counterLabel,
    steps: uploadSteps(),
    labels: progressLabels(),
  });
  $('#btn-back-run')?.addEventListener('click', () => {
    state.view = 'run';
    render();
  });
  $('#btn-start-upload')?.addEventListener('click', () => void doStartUpload());
  $('#btn-pause-upload')?.addEventListener('click', () => void doPauseUpload());
  $('#btn-resume-upload')?.addEventListener('click', () => void doResumeUpload());
  $('#btn-discard-upload')?.addEventListener('click', () => void doDiscardUpload());
  // Force a fresh session check on entry so a "re-authorise needed" hint shows
  // up-front here, not only after the upload attempt fails.
  paintReconnectNotice();
  void revalidateSession(true).then(paintReconnectNotice);
  // Surface an upload the last session left unfinished (paused, or killed
  // mid-run) so the operator can continue it instead of starting over.
  void refreshJobView();
}

// ============= Durable upload job (pause / resume / kill-recovery) =============

/** Pull the main process's job view and repaint the pause/resume affordances. */
async function refreshJobView(): Promise<void> {
  try {
    state.resumableJob = await window.sc.uploadJob.get();
  } catch {
    state.resumableJob = null;
  }
  state.uploadPaused = state.resumableJob?.state?.status === 'paused';
  paintJobNotice();
}

/**
 * Paint the resume banner + button visibility from the job view.
 * Three mutually-exclusive shapes: idle (nothing), running (Pause offered),
 * resumable (banner + Resume/Discard).
 */
function paintJobNotice(): void {
  const notice = $('#resume-notice');
  const startBtn = $('#btn-start-upload') as HTMLButtonElement | null;
  const pauseBtn = $('#btn-pause-upload') as HTMLButtonElement | null;
  const resumeBtn = $('#btn-resume-upload') as HTMLButtonElement | null;
  const discardBtn = $('#btn-discard-upload') as HTMLButtonElement | null;
  if (!notice || !startBtn || !pauseBtn || !resumeBtn || !discardBtn) return;

  const job = state.resumableJob;
  const resumable = Boolean(job?.resumable);
  const running = uploadRunning;

  pauseBtn.style.display = running ? '' : 'none';
  resumeBtn.style.display = !running && resumable ? '' : 'none';
  discardBtn.style.display = !running && resumable ? '' : 'none';
  // A resumable job makes "start over" the wrong default — hide it so the
  // operator resumes rather than silently re-uploading everything.
  startBtn.style.display = !running && resumable ? 'none' : '';

  if (!running && resumable && job?.resumeHint) {
    notice.textContent =
      t('upload.job.resumeBanner', { hint: job.resumeHint }) ||
      `Unterbrochener Upload gefunden (${job.resumeHint}) — fortsetzen?`;
    notice.style.display = 'block';
  } else {
    notice.style.display = 'none';
  }
}

/** True while this renderer is actively driving the stages. */
let uploadRunning = false;

async function doPauseUpload(): Promise<void> {
  // Only signals intent — the stages unwind at their next chunk boundary, and
  // the main process persists the cursor.
  state.resumableJob = await window.sc.uploadJob.pause();
  setAuthStatus(t('upload.job.pausing', {}) || 'Pausiere nach dem aktuellen Schritt…', 'warn');
}

async function doResumeUpload(): Promise<void> {
  await window.sc.uploadJob.resume();
  setAuthStatus(t('upload.job.resumed', {}) || 'Upload wird fortgesetzt…', 'ok');
  await doStartUpload();
}

async function doDiscardUpload(): Promise<void> {
  state.resumableJob = await window.sc.uploadJob.cancel();
  state.uploadPaused = false;
  setAuthStatus(t('upload.job.cancelled', {}) || 'Upload verworfen — der Fortschritt wurde gelöscht.', 'warn');
  paintJobNotice();
}

// Show/hide the "your login expired — reconnect first" hint on the upload view,
// reflecting the current connection status. Safe to call when the view isn't
// mounted (the element lookup simply misses).
function paintReconnectNotice(): void {
  const el = $('#reconnect-notice');
  if (!el) return;
  const needsReconnect = conn.status ? !conn.status.connected : false;
  if (needsReconnect) {
    const msg = conn.status?.needsReconnect
      ? t('upload.reconnectExpired', {}) || 'Deine Sitzung ist abgelaufen — melde dich beim Upload-Start neu an.'
      : t('upload.reconnectOffline', {}) || 'Nicht mit dem Web verbunden — der Upload-Start meldet dich an.';
    el.textContent = msg;
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

// One-shot flow: trigger browser login if needed, then immediately upload.
// Keeps the loopback OAuth server open only for the few seconds between
// "open browser" and "fetch back the token" — no idle window where the
// user could close the tool and break the handoff.
async function doStartUpload(): Promise<void> {
  if (!state.lastResult) return;
  const btn = $('#btn-start-upload') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  uploadRunning = true;
  paintJobNotice();
  uploadProgress?.start();
  uploadProgress?.setStep(0);
  try {
    if (!state.authToken) {
      uploadProgress?.update({
        phaseLabel: t('upload.signingIn', {}) || 'Im Browser anmelden…',
        indeterminate: true,
        detail: '',
      });
      const token = await ensureUploadToken();
      if (!token) {
        uploadProgress?.update({ indeterminate: false });
        uploadProgress?.stop();
        setAuthStatus(t('upload.signInFailed', {}) || 'Anmeldung fehlgeschlagen', 'error');
        return;
      }
    }
    await doUploadAfterAuth();
  } finally {
    if (btn) btn.disabled = false;
    uploadRunning = false;
    // Re-read the durable job: it decides whether we now offer Resume (paused
    // or interrupted) or nothing at all (finished).
    await refreshJobView();
  }
}

// Server-side error codes the ingest-bundle edge function can return. Anything
// NOT in this set is a transport-layer message (network down, timeout, …).
const KNOWN_UPLOAD_ERRORS = new Set([
  'unauthorized', 'forbidden', 'missing_release_token', 'unknown_release_token',
  'release_token_revoked', 'duplicate', 'ingest_failed', 'invalid_body',
  'invalid_json', 'server_misconfigured', 'method_not_allowed',
]);

// Turn a raw upload failure (server error code + optional server `message`, or
// a network/timeout message) into a sentence a non-technical operator can act
// on, while still surfacing the technical detail for support.
function friendlyUploadError(r: { error?: string; details?: unknown }): string {
  const code = r.error ?? 'unknown';
  const serverMsg =
    r.details && typeof r.details === 'object'
      ? (r.details as { message?: unknown }).message
      : undefined;

  let friendly: string;
  switch (code) {
    case 'unauthorized':
      friendly = t('upload.err.unauthorized'); break;
    case 'forbidden':
      friendly = t('upload.err.forbidden'); break;
    case 'missing_release_token':
    case 'unknown_release_token':
    case 'release_token_revoked':
      friendly = t('upload.err.releaseToken'); break;
    case 'duplicate':
      friendly = t('upload.err.duplicate'); break;
    case 'ingest_failed':
      friendly = t('upload.err.ingestFailed'); break;
    case 'invalid_body':
    case 'invalid_json':
      friendly = t('upload.err.invalidBody'); break;
    case 'server_misconfigured':
      friendly = t('upload.err.serverMisconfigured'); break;
    case 'timeout':
      friendly = t('upload.err.timeout'); break;
    default:
      // Unknown code === a raw fetch/timeout message from the transport layer.
      friendly = KNOWN_UPLOAD_ERRORS.has(code) ? t('upload.err.generic') : t('upload.err.network');
  }

  const detail =
    (typeof serverMsg === 'string' && serverMsg) ||
    (KNOWN_UPLOAD_ERRORS.has(code) ? code : r.error);
  return detail && detail !== friendly
    ? t('upload.err.withDetail', { friendly, detail })
    : friendly;
}

async function doUploadAfterAuth(): Promise<void> {
  if (!state.authToken || !state.lastResult) return;
  const result = state.lastResult;
  // Register (or adopt) the durable job BEFORE any network call, so even a kill
  // during the very first request leaves a resumable record behind. Adopting an
  // existing job for the same out_dir is what turns "reopen the app" into
  // "continue where we stopped".
  await window.sc.uploadJob.begin(result.output_dir, {
    channel: result.channel,
    patchVersion: result.patch_version,
    buildNumber: result.build_number,
  });
  uploadProgress?.setStep(0);
  uploadProgress?.update({
    phaseLabel: t('upload.bundleUploading', {}) || 'Bundle-Metadaten werden hochgeladen…',
    indeterminate: true,
    detail: '',
  });
  const ch = result.channel as 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  const r = await window.sc.upload({
    accessToken: state.authToken,
    channel: ch,
    patchVersion: result.patch_version,
    buildNumber: result.build_number,
    schemaVersion: result.schema_version,
    qualityScore: result.quality_score,
    entityCounts: result.entity_counts,
    manifest: {},
    manifestPath: result.manifest_path,
  });
  if (!r.ok) {
    uploadProgress?.update({ indeterminate: false });
    uploadProgress?.stop();
    setAuthStatus(friendlyUploadError(r), 'error');
    return;
  }
  uploadProgress?.update({ indeterminate: false, overallPct: 100 });
  setAuthStatus(
    `${t('upload.uploadOk', {}) || 'Upload OK'} · bundle_id ${r.bundleId ?? '—'}`,
    'ok',
  );
  paintDiffSummary(r.diffSummary);

  // Promote the extract into the public Codex (codex_* tables) BEFORE cleanup,
  // so the out_dir still exists. Non-fatal: the bundle upload already succeeded;
  // a codex failure only means the public catalog isn't refreshed this run.
  uploadProgress?.setStep(1);
  const codex = await promoteToCodex(result.output_dir, uploadProgress);
  // Stop the whole run on a pause. Falling through would upload skins and —
  // worse — reach the cleanup below, deleting the out_dir that a resume needs.
  if (codex === 'paused') {
    setAuthStatus(t('upload.job.paused', {}) || 'Upload pausiert — der Fortschritt ist gespeichert.', 'warn');
    return;
  }

  // Build + upload the 3D liveries as part of the SAME upload — skins are a
  // sub-property of every ship, not a separate step. Reads the extract's build
  // manifest, cached per patch version. Runs BEFORE cleanup (manifest lives in
  // out_dir). Fully non-fatal: the bundle is already confirmed.
  uploadProgress?.setStep(2);
  try {
    await buildAndUploadSkins(result, uploadProgress);
  } catch (err) {
    uploadProgress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('skins.buildFailed', {}) || '3D-Skins übersprungen (Bundle ist hochgeladen)'}: ${(err as Error).message}`,
      'warn',
    );
  }
  uploadProgress?.stop();

  // Paused during the skin stage — same reasoning as the codex stage above:
  // never clean up an out_dir a resume still needs.
  const jobAfterSkins = await window.sc.uploadJob.get();
  if (jobAfterSkins.state?.status === 'paused') {
    setAuthStatus(t('upload.job.paused', {}) || 'Upload pausiert — der Fortschritt ist gespeichert.', 'warn');
    return;
  }

  // Every stage confirmed — drop the job file so the next launch doesn't offer
  // to resume an upload that already finished.
  await window.sc.uploadJob.finish();

  // Upload confirmed — reclaim the run's extracted files so they don't fill
  // the disk. Best-effort: the main process guards + swallows failures.
  const outDir = state.lastResult?.output_dir;
  if (outDir) {
    const cleaned = await window.sc.cleanup.extractDir(outDir, {
      bundleId: r.bundleId,
      channel: result.channel,
      version: result.patch_version,
    });
    if (cleaned.ok) {
      setAuthStatus(
        `${t('upload.uploadOk', {}) || 'Upload OK'} · bundle_id ${r.bundleId ?? '—'} · ` +
          (t('upload.cleaned', {}) || 'Extrahierte Dateien aufgeräumt (Upload bestätigt)'),
        'ok',
      );
    }
  }
}

// Drive the codex promotion with a live per-table progress line. Non-fatal:
// any failure is surfaced as a warning but never blocks the confirmed upload.
// `progress` is optional so this stays callable without a mounted view (tests).
async function promoteToCodex(
  outDir: string | undefined,
  progress?: ProgressController | null,
): Promise<'ok' | 'failed' | 'paused'> {
  if (!outDir || !state.authToken) return 'failed';
  const label = t('catalog.publishing', {}) || 'Codex wird veröffentlicht';
  progress?.update({ phaseLabel: label, indeterminate: true, detail: '' });
  const unsub = window.sc.catalog.onEvent((ev) => {
    // phaseIndex/phaseTotal are additive fields (catalog-bridge.ts) — an
    // overall two-tier bar: which of the ~14 fixed publish steps we're on,
    // refined by how far the CURRENT step's own current/total has gotten.
    const stepFrac = ev.total > 0 ? ev.current / ev.total : 0;
    const overallPct =
      typeof ev.phaseIndex === 'number' && typeof ev.phaseTotal === 'number' && ev.phaseTotal > 0
        ? Math.round(((ev.phaseIndex - 1 + stepFrac) / ev.phaseTotal) * 100)
        : undefined;
    const stageLbl =
      typeof ev.phaseIndex === 'number' && typeof ev.phaseTotal === 'number'
        ? t('catalog.step', { current: String(ev.phaseIndex), total: String(ev.phaseTotal) }) ||
          `Step ${ev.phaseIndex}/${ev.phaseTotal}`
        : undefined;
    progress?.update({
      phaseLabel: label,
      stageLabel: stageLbl,
      current: ev.current,
      total: ev.total > 0 ? ev.total : undefined,
      overallPct,
      detail: ev.phase,
      indeterminate: false,
    });
  });
  try {
    const res = await window.sc.catalog.upload(state.authToken, outDir);
    if (res.ok) {
      const ships = res.counts?.['ships'] ?? 0;
      progress?.update({ overallPct: 100, indeterminate: false });
      setAuthStatus(
        `${t('catalog.published', {}) || 'Codex aktualisiert'} · ${ships} ${t('catalog.ships', {}) || 'Schiffe'}`,
        'ok',
      );
      return 'ok';
    }
    // A pause is not a failure — the cursor is safe on disk and the operator
    // asked for this. Say so instead of showing a red "publish failed".
    if (res.error === 'paused' || res.error === 'cancelled') {
      progress?.update({ indeterminate: false });
      progress?.stop();
      return 'paused';
    }
    progress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('catalog.failed', {}) || 'Codex-Veröffentlichung fehlgeschlagen'}: ${res.error ?? '—'}`,
      'error',
    );
    return 'failed';
  } catch (err) {
    progress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('catalog.failed', {}) || 'Codex-Veröffentlichung fehlgeschlagen'}: ${(err as Error).message}`,
      'error',
    );
    return 'failed';
  } finally {
    unsub();
  }
}

function paintDiffSummary(diff: unknown): void {
  const mount = $('#upload-result');
  if (!mount) return;
  if (!diff) {
    mount.innerHTML = '<p class="ok">Erster Upload für diese Patch-Familie — kein Diff zur Anzeige.</p>';
    return;
  }
  // Server shape (diff_bundle in migration 00005, ingest_bundle_atomic in
  // 00006): { prev_id, new_id, count_diffs: { <entity>: {prev, new, delta} },
  // summary: { entities_added, entities_removed } }
  const d = diff as {
    count_diffs?: Record<string, { prev: number; new: number; delta: number }>;
    summary?: { entities_added: number; entities_removed: number };
  };
  const totalAdded = d.summary?.entities_added ?? 0;
  const totalRemoved = d.summary?.entities_removed ?? 0;
  const rows = d.count_diffs
    ? Object.entries(d.count_diffs)
        .filter(([, v]) => v.delta !== 0)
        .sort(([, a], [, b]) => Math.abs(b.delta) - Math.abs(a.delta))
        .map(
          ([key, v]) => {
            const deltaCls = v.delta > 0 ? 'ok' : v.delta < 0 ? 'error' : '';
            const sign = v.delta > 0 ? '+' : '';
            return `<tr><td>${key}</td><td>${v.prev}</td><td>${v.new}</td><td class="${deltaCls}">${sign}${v.delta}</td></tr>`;
          },
        )
        .join('')
    : '';
  mount.innerHTML = `
    <h3>Diff vs. previous bundle</h3>
    <p>Σ <span class="ok">+${totalAdded.toLocaleString()}</span>
       / <span class="error">−${totalRemoved.toLocaleString()}</span></p>
    <div class="diff-scroll">
      <table class="diff-table">
        <thead><tr><th>entity</th><th>prev</th><th>new</th><th>delta</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4"><em>no entity changes</em></td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function setAuthStatus(msg: string, cls: 'ok' | 'warn' | 'error'): void {
  const el = $('#auth-status');
  if (!el) return;
  el.textContent = msg;
  el.className = cls;
}

// ============= 3D liveries (built + uploaded inside the normal upload) =======

// Build + upload every ship's 3D liveries as part of the confirmed bundle
// upload — skins are a sub-property of each ship, not a separate view. Driven
// by the extract's skins/_build_manifest.json and cached per patch version:
// the first run of a patch is long (builds all glbs), re-runs skip ships that
// are already built + uploaded. Entirely non-fatal — the bundle upload has
// already succeeded, so any skin failure only means liveries aren't refreshed.
async function buildAndUploadSkins(
  result: ExtractResultPayload,
  progress?: ProgressController | null,
): Promise<void> {
  if (!state.authToken) return;
  const ch = state.channels.find((c) => c.selected) ?? state.channels[0];
  if (!ch) return;

  const manifest = `${result.output_dir}/skins/_build_manifest.json`;
  const skinsOut = `${ch.installPath}/.sc-companion-extracts/skins-${result.patch_version}`;
  const label = t('skins.building', {}) || '3D-Skins werden gebaut';

  // 1. ensure cgf-converter (first-use download ~117 MB).
  const toolsLabel = t('skins.stepTools', {}) || 'Build-Tools werden geladen';
  progress?.update({ phaseLabel: toolsLabel, indeterminate: true, detail: '' });
  const unsubTools = window.sc.skin.onToolProgress((pct) =>
    progress?.update({ phaseLabel: toolsLabel, current: pct, total: 100, overallPct: pct, indeterminate: false }),
  );
  const tools = await window.sc.skin.ensureTools();
  unsubTools();
  if (!tools.ok) {
    progress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('skins.toolsFailed', {}) || '3D-Tools nicht verfügbar — Skins übersprungen'}: ${tools.error ?? '—'}`,
      'warn',
    );
    return;
  }

  // 2. build glbs (streams; first run per patch is long, cached runs are quick).
  // Reads ev.pct (phase events) AND ev.current/ev.total (ships progress
  // events, see skin_export_app.py) so the card shows "ship X / Y" plus a
  // moving overall bar instead of just a static phase word.
  progress?.update({
    phaseLabel: label,
    indeterminate: true,
    detail: '',
    hint: t('skins.hintBuild', {}) || 'Erst-Build baut jedes Schiff einzeln — kann pro Schiff einige Minuten dauern.',
  });
  const skinCounters: Record<string, number> = {};
  const unsub = window.sc.skin.onEvent((ev) => {
    if (ev.type === 'phase' && ev.phase) {
      progress?.update({ phaseLabel: `${label}: ${ev.phase}`, overallPct: ev.pct });
    } else if (ev.type === 'progress') {
      progress?.update({
        stageLabel:
          t('skins.shipProgress', { current: String(ev.current ?? 0), total: String(ev.total ?? 0) }) ||
          `Ship ${ev.current}/${ev.total}`,
        current: ev.current,
        total: ev.total,
        overallPct: ev.pct,
        detail: ev.detail,
      });
    } else if (ev.type === 'count' && ev.counter) {
      skinCounters[ev.counter.key] = ev.counter.value;
      progress?.update({ counters: skinCounters });
    } else if (ev.type === 'log' && ev.level === 'error') {
      progress?.update({ detail: ev.message ?? '' });
    }
  });
  const built = await window.sc.skin
    .start({ p4kPath: ch.dataP4kPath, outDir: skinsOut, manifest, skipExisting: true })
    .finally(unsub);
  if (!built.ok || !built.ships) {
    progress?.update({ indeterminate: false });
    setAuthStatus(
      `${t('skins.buildFailed', {}) || '3D-Skins-Build fehlgeschlagen (Bundle ist hochgeladen)'}: ${built.error ?? '—'}`,
      'warn',
    );
    return;
  }
  state.skinResult = built.ships;
  if (built.ships.length === 0) {
    progress?.update({ indeterminate: false });
    setAuthStatus(t('skins.none', {}) || 'Keine baubaren 3D-Skins gefunden.', 'ok');
    return;
  }

  // 3. upload (upload-cache skips ships already shipped in a prior run).
  progress?.update({
    phaseLabel: t('skins.stepUpload', {}) || t('skins.uploading', {}) || '3D-Skins werden hochgeladen…',
    indeterminate: true,
    current: 0,
    total: built.ships.length,
    detail: '',
    hint: t('skins.hintUpload', {}) || 'Große Livery-Dateien werden übertragen — je nach Größe dauert das.',
  });
  const results = await window.sc.skin.upload(
    state.authToken,
    built.ships.map((s) => ({ shipId: s.ship_id, dir: s.export_dir })),
  );
  const okCount = results.filter((r) => r.ok).length;
  progress?.update({ indeterminate: false, current: okCount, total: results.length, overallPct: 100 });
  setAuthStatus(
    okCount === results.length
      ? t('skins.done', { n: String(okCount) }) || `3D-Skins fertig — ${okCount} Schiff(e) live.`
      : `${okCount}/${results.length} ${t('skins.partial', {}) || 'Schiffe hochgeladen (Rest siehe Protokoll)'}`,
    okCount === results.length ? 'ok' : 'warn',
  );
}

void init();
