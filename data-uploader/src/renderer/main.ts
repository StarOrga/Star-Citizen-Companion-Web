/**
 * Renderer entry — Phase 1 shell.
 *
 * Three views: Discover → Configure → Run. View routing is a simple state
 * machine — no framework yet (keep the bundle tiny). Phase 2 may bring in
 * Lit or Preact if the UI grows.
 */

import { load as loadI18n, setLocale, getLocale, t, type LocaleId } from '../lib/i18n.js';

interface ToolEnv {
  toolVersion: string;
  apiBase: string;
  releaseTokenFingerprint: string;
  platform: string;
}

const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

type ViewName = 'discover' | 'configure' | 'run' | 'auth-upload' | 'skins';
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

const state = {
  view: 'discover' as ViewName,
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
  lastResult: null as ExtractResultPayload | null,
  authToken: null as string | null,
  skinShips: 'DRAK_Cutlass_Black',
  skinResult: null as SkinShipResult[] | null,
};

async function init(): Promise<void> {
  await loadI18n();
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

  // Auto-update banner — subscribe + paint last known status (no-op on dev).
  window.sc.update.onEvent(paintUpdateBanner);
  void window.sc.update.status().then(paintUpdateBanner);

  // Web-connection tile — auto-connect (persisted session) + auto-sync.
  void initConnectionTile();

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
  | { type: 'error'; message: string };

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
    case 'skins':
      app.innerHTML = renderSkins();
      wireSkins();
      break;
  }
}

// ============= View: Discover =============

function renderDiscover(): string {
  return `
    <h1>${t('discover.title', {}) || 'Star-Citizen-Installations finden'}</h1>
    <p>${t('discover.subtitle', {}) || 'Cascade läuft automatisch: RSI-Launcher → Filesystem-Scan → optional manuell.'}</p>
    <div class="btn-row">
      <button id="btn-discover" class="btn btn-primary">${t('discover.scan', {}) || 'Scan starten'}</button>
      <button id="btn-manual" class="btn">${t('discover.manual', {}) || 'Ordner manuell wählen'}</button>
    </div>
    <div id="channels-mount"></div>
    <div class="btn-row" id="discover-next" style="display:none; margin-top: 18px;">
      <button id="btn-to-configure" class="btn btn-primary">${t('discover.next', {}) || 'Weiter → Konfiguration'}</button>
      <button id="btn-to-skins" class="btn">${t('skins.open', {}) || '3D-Skins extrahieren'}</button>
    </div>
  `;
}

function wireDiscover(): void {
  $('#btn-discover')?.addEventListener('click', async () => {
    setStatus('discovering…');
    const found = await window.sc.discover();
    state.channels = found.map((c) => ({ ...c, selected: true }));
    paintChannels();
    setStatus(`found ${found.length} channel(s)`);
  });

  $('#btn-manual')?.addEventListener('click', async () => {
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
  });

  $('#btn-to-configure')?.addEventListener('click', () => {
    state.view = 'configure';
    render();
  });

  $('#btn-to-skins')?.addEventListener('click', () => {
    state.view = 'skins';
    render();
  });
}

function paintChannels(): void {
  const mount = $('#channels-mount');
  const nextRow = $('#discover-next');
  if (!mount) return;
  if (state.channels.length === 0) {
    mount.innerHTML = '';
    if (nextRow) nextRow.style.display = 'none';
    return;
  }
  mount.innerHTML = `
    <div class="card">
      <h2>${t('discover.found', {}) || 'Gefundene Channels'}</h2>
      <div class="channel-list">
        ${state.channels
          .map(
            (c, i) => `
          <label class="channel-row">
            <input type="checkbox" data-idx="${i}" ${c.selected ? 'checked' : ''} />
            <span class="channel-pill ${c.channel}">${c.channel}</span>
            <div class="channel-meta">
              <span class="channel-name">${c.version ? 'v' + c.version : c.channel + ' (no version)'}</span>
              <span class="channel-path">${c.installPath}</span>
            </div>
            <span class="channel-size">${(c.sizeBytes / 1024 ** 3).toFixed(1)} GB</span>
          </label>
        `,
          )
          .join('')}
      </div>
    </div>
  `;
  mount.querySelectorAll('input[type=checkbox]').forEach((el) => {
    el.addEventListener('change', (e) => {
      const idx = Number((e.target as HTMLInputElement).dataset['idx']);
      if (!Number.isInteger(idx)) return;
      const ch = state.channels[idx];
      if (ch) ch.selected = (e.target as HTMLInputElement).checked;
    });
  });
  if (nextRow) nextRow.style.display = 'flex';
}

// ============= View: Configure =============

function renderConfigure(): string {
  return `
    <h1>${t('configure.title', {}) || 'Profil wählen'}</h1>
    <p>${t('configure.subtitle', {}) || 'Live umschaltbar — du kannst während des Laufs wechseln.'}</p>
    <div class="profiles" id="profiles-mount"></div>
    <div class="btn-row" style="margin-top:18px;">
      <button id="btn-back-discover" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
      <button id="btn-start-run" class="btn btn-primary">${t('configure.start', {}) || 'Extraktion starten'}</button>
    </div>
  `;
}

function wireConfigure(): void {
  void renderProfiles();
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
    <h1>${t('run.title', {}) || 'Extraktion läuft'}</h1>
    <div class="card">
      <h2 id="phase-label">…</h2>
      <div class="progress-bar"><span id="bar" style="width:0%"></span></div>
      <div class="counters" id="counters"></div>
      <div class="log-header">
        <span class="log-title">${t('run.logTitle', {}) || 'Protokoll'}</span>
        <button id="btn-copy-log" type="button" class="btn btn-copy">${t('run.copyLog', {}) || 'Kopieren'}</button>
      </div>
      <div class="log-stream" id="log"></div>
    </div>
    <div class="btn-row">
      <button id="btn-back-configure" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
      <button id="btn-to-upload" class="btn btn-primary" disabled>${t('run.next', {}) || 'Upload anbieten'}</button>
    </div>
  `;
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
  const bar = $('#bar') as HTMLElement | null;
  const phase = $('#phase-label');
  const logEl = $('#log');
  const counters = $('#counters');
  const setBar = (pct: number) => {
    if (bar) bar.style.width = pct + '%';
  };
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
  const paintCounters = (): void => {
    if (!counters) return;
    counters.innerHTML = Object.entries(countMap)
      .map(
        ([key, value]) =>
          `<div class="counter"><div class="label">${key}</div><div class="value">${value.toLocaleString()}</div></div>`,
      )
      .join('');
  };

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
      case 'phase':
        if (phase) phase.textContent = ev.phase ?? '…';
        if (typeof ev.pct === 'number') setBar(ev.pct);
        appendLog(`[phase] ${ev.phase ?? 'unknown'}`);
        return;
      case 'file':
        if (typeof ev.pct === 'number') setBar(ev.pct);
        if (ev.fileName) appendLog(`  · ${ev.fileName}`);
        return;
      case 'count':
        if (ev.counter) {
          countMap[ev.counter.key] = ev.counter.value;
          paintCounters();
        }
        return;
      case 'log':
        appendLog(ev.message ?? '', ev.level ?? 'info');
        return;
      case 'warning':
        appendLog(ev.message ?? 'warning', 'warn');
        return;
      case 'done':
        setBar(100);
        return;
      case 'error':
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
      appendLog(
        `done — quality ${final.result.quality_score.toFixed(0)}/100, ` +
          `${Object.values(final.result.entity_counts).reduce((a, b) => a + b, 0).toLocaleString()} entities`,
        'success',
      );
      ($('#btn-to-upload') as HTMLButtonElement | null)?.removeAttribute('disabled');
    } else {
      appendLog(final.error ?? 'unknown extraction failure', 'error');
    }
  } finally {
    unsubscribe();
  }
}

// ============= View: Auth-Upload =============

function renderAuthUpload(): string {
  const result = state.lastResult;
  const hasResult = result !== null;
  const counts = hasResult
    ? Object.entries(result!.entity_counts)
        .map(([k, v]) => `<li><strong>${k}:</strong> ${v.toLocaleString()}</li>`)
        .join('')
    : '<li><em>no extraction yet</em></li>';
  return `
    <h1>${t('upload.title', {}) || 'Upload'}</h1>
    <div class="card">
      <p>${t('upload.intro', {}) || 'Beim Upload-Start öffnet sich der Browser zum Anmelden. Nach erfolgreichem Login wird das Bundle automatisch hochgeladen.'}</p>
      <div class="btn-row">
        <button id="btn-start-upload" class="btn btn-primary" ${hasResult ? '' : 'disabled'}>${t('upload.start', {}) || 'Upload starten'}</button>
      </div>
      <p id="auth-status" class="warn" style="margin-top: 10px;"></p>
    </div>
    <div class="card" style="margin-top: 12px;">
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
        <ul class="bundle-meta">${counts}</ul>
      `
        : '<p class="warn">No extraction result — go back and run the extractor first.</p>'}
      <div id="upload-result" style="margin-top: 14px;"></div>
    </div>
    <div class="btn-row">
      <button id="btn-back-run" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
    </div>
  `;
}

function wireAuthUpload(): void {
  $('#btn-back-run')?.addEventListener('click', () => {
    state.view = 'run';
    render();
  });
  $('#btn-start-upload')?.addEventListener('click', () => void doStartUpload());
}

// One-shot flow: trigger browser login if needed, then immediately upload.
// Keeps the loopback OAuth server open only for the few seconds between
// "open browser" and "fetch back the token" — no idle window where the
// user could close the tool and break the handoff.
async function doStartUpload(): Promise<void> {
  if (!state.lastResult) return;
  const btn = $('#btn-start-upload') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  try {
    if (!state.authToken) {
      setAuthStatus(t('upload.signingIn', {}) || 'Im Browser anmelden…', 'warn');
      const token = await ensureUploadToken();
      if (!token) {
        setAuthStatus(t('upload.signInFailed', {}) || 'Anmeldung fehlgeschlagen', 'error');
        return;
      }
    }
    await doUploadAfterAuth();
  } finally {
    if (btn) btn.disabled = false;
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
  setAuthStatus(t('upload.uploading', {}) || 'Upload läuft…', 'warn');
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
    setAuthStatus(friendlyUploadError(r), 'error');
    return;
  }
  setAuthStatus(
    `${t('upload.uploadOk', {}) || 'Upload OK'} · bundle_id ${r.bundleId ?? '—'}`,
    'ok',
  );
  paintDiffSummary(r.diffSummary);

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
    <table class="diff-table">
      <thead><tr><th>entity</th><th>prev</th><th>new</th><th>delta</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4"><em>no entity changes</em></td></tr>'}</tbody>
    </table>
  `;
}

function setAuthStatus(msg: string, cls: 'ok' | 'warn' | 'error'): void {
  const el = $('#auth-status');
  if (!el) return;
  el.textContent = msg;
  el.className = cls;
}

// ============= View: Skins (3D livery export → upload) =============

function pickSkinChannel(): (typeof state.channels)[number] | undefined {
  return state.channels.find((c) => c.selected) ?? state.channels[0];
}

function renderSkins(): string {
  const ch = pickSkinChannel();
  const chInfo = ch
    ? `<p class="ok">${ch.channel}${ch.version ? ' v' + ch.version : ''} · ${ch.dataP4kPath}</p>`
    : `<p class="warn">${t('skins.noChannel', {}) || 'Kein Channel gefunden — erst auf der Discover-Seite scannen.'}</p>`;
  return `
    <h1>${t('skins.title', {}) || '3D-Skins extrahieren & hochladen'}</h1>
    <div class="card">
      <p>${t('skins.intro', {}) || 'Baut pro Schiff ein web-fähiges glb je Lackierung (100% aus der Data.p4k) und lädt es in die App. cgf-converter wird beim ersten Mal geladen (~117 MB). Pro Skin ~2–3 Min.'}</p>
      ${chInfo}
      <label class="field">
        <span>${t('skins.shipsLabel', {}) || 'Schiffe (Komma-getrennt, z. B. DRAK_Cutlass_Black)'}</span>
        <input id="skin-ships" type="text" value="${state.skinShips.replace(/"/g, '&quot;')}" spellcheck="false" />
      </label>
      <div class="btn-row" style="margin-top:12px;">
        <button id="btn-skin-run" class="btn btn-primary" ${ch ? '' : 'disabled'}>${t('skins.run', {}) || 'Bauen & Hochladen'}</button>
        <button id="btn-skin-back" class="btn">← ${t('common.back', {}) || 'Zurück'}</button>
      </div>
    </div>
    <div class="card" style="margin-top:12px;">
      <h2 id="skin-phase">…</h2>
      <div class="progress-bar"><span id="skin-bar" style="width:0%"></span></div>
      <div class="log-stream" id="skin-log"></div>
      <p id="skin-status" class="warn" style="margin-top:10px;"></p>
    </div>
  `;
}

function wireSkins(): void {
  $('#btn-skin-back')?.addEventListener('click', () => {
    state.view = 'discover';
    render();
  });
  const input = $('#skin-ships') as HTMLInputElement | null;
  input?.addEventListener('input', () => {
    state.skinShips = input.value;
  });
  $('#btn-skin-run')?.addEventListener('click', () => void runSkinFlow());
}

async function runSkinFlow(): Promise<void> {
  const ch = pickSkinChannel();
  const btn = $('#btn-skin-run') as HTMLButtonElement | null;
  const bar = $('#skin-bar') as HTMLElement | null;
  const phaseEl = $('#skin-phase');
  const logEl = $('#skin-log');
  const setBar = (pct: number): void => {
    if (bar) bar.style.width = pct + '%';
  };
  const appendLog = (msg: string, level: LogLevel = 'info'): void => {
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'log-line log-' + level;
    line.textContent = (level === 'error' ? '[err] ' : level === 'warn' ? '[warn] ' : '') + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  };
  const setSkinStatus = (msg: string, cls: 'ok' | 'warn' | 'error'): void => {
    const el = $('#skin-status');
    if (el) {
      el.textContent = msg;
      el.className = cls;
    }
  };

  const ships = state.skinShips.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!ch || ships.length === 0) {
    setSkinStatus(t('skins.needInput', {}) || 'Channel + mindestens ein Schiff nötig.', 'error');
    return;
  }
  if (btn) btn.disabled = true;

  try {
    // 1. ensure cgf-converter (downloads on first use)
    setSkinStatus(t('skins.tools', {}) || 'Build-Tools werden sichergestellt…', 'warn');
    const unsubTools = window.sc.skin.onToolProgress((pct) => setBar(pct));
    const tools = await window.sc.skin.ensureTools();
    unsubTools();
    if (!tools.ok) {
      setSkinStatus(`${t('skins.toolsFailed', {}) || 'Tool-Download fehlgeschlagen'}: ${tools.error ?? '—'}`, 'error');
      return;
    }
    setBar(0);

    // 2. build glbs (streams events)
    const outDir = `${ch.installPath}/.sc-companion-extracts/skins-${ch.version ?? 'unknown'}`;
    appendLog(`${ships.length} ship(s) → ${outDir}`);
    const unsub = window.sc.skin.onEvent((ev) => {
      switch (ev.type) {
        case 'phase':
          if (phaseEl) phaseEl.textContent = ev.phase ?? '…';
          if (typeof ev.pct === 'number') setBar(ev.pct);
          return;
        case 'count':
          if (ev.counter) appendLog(`${ev.counter.key}: ${ev.counter.value} skin(s)`, 'success');
          return;
        case 'log':
          appendLog(ev.message ?? '', ev.level ?? 'info');
          return;
        case 'error':
          appendLog(ev.message ?? 'error', 'error');
          return;
      }
    });

    const final = await window.sc.skin
      .start({ p4kPath: ch.dataP4kPath, outDir, ships })
      .finally(unsub);
    if (!final.ok || !final.ships) {
      setSkinStatus(`${t('skins.buildFailed', {}) || 'Build fehlgeschlagen'}: ${final.error ?? '—'}`, 'error');
      return;
    }
    state.skinResult = final.ships;
    setBar(100);

    // 3. auth (reuse the persisted session if present) + upload
    if (!state.authToken) {
      setSkinStatus(t('upload.signingIn', {}) || 'Im Browser anmelden…', 'warn');
      const token = await ensureUploadToken();
      if (!token) {
        setSkinStatus(t('upload.signInFailed', {}) || 'Anmeldung fehlgeschlagen', 'error');
        return;
      }
    }
    setSkinStatus(t('skins.uploading', {}) || 'Upload läuft…', 'warn');
    const results = await window.sc.skin.upload(
      state.authToken,
      final.ships.map((s) => ({ shipId: s.ship_id, dir: s.export_dir })),
    );
    for (const res of results) {
      if (res.ok) {
        appendLog(`✓ ${res.ship_id}: ${res.uploaded ?? 0} Objekte, ${res.committed ?? 0} Zeilen`, 'success');
      } else {
        appendLog(`✗ ${res.ship_id}: ${res.error ?? 'Fehler'}`, 'error');
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    setSkinStatus(
      okCount === results.length
        ? (t('skins.done', {}) || 'Fertig — Skins sind live in der App.')
        : `${okCount}/${results.length} ${t('skins.partial', {}) || 'Schiffe hochgeladen (Rest siehe Log)'}`,
      okCount === results.length ? 'ok' : 'warn',
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

void init();
