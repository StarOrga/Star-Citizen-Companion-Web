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

type ViewName = 'discover' | 'configure' | 'run' | 'auth-upload';

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
    });
  }

  // Auto-update banner — subscribe + paint last known status (no-op on dev).
  window.sc.update.onEvent(paintUpdateBanner);
  void window.sc.update.status().then(paintUpdateBanner);

  render();
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
        <div class="profile-pill ${active}" data-profile="${p.id}">
          <span class="name">${label}</span>
          <span class="desc">${desc}</span>
          <span class="eta">~ ${eta.formatted}</span>
        </div>`;
    }),
  );
  mount.innerHTML = entries.join('');
  mount.querySelectorAll('.profile-pill').forEach((el) => {
    el.addEventListener('click', () => {
      state.profile = (el as HTMLElement).dataset['profile'] as typeof state.profile;
      void renderProfiles();
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
  void runRealExtract();
}

async function runRealExtract(): Promise<void> {
  const bar = $('#bar') as HTMLElement | null;
  const phase = $('#phase-label');
  const logEl = $('#log');
  const counters = $('#counters');
  const setBar = (pct: number) => {
    if (bar) bar.style.width = pct + '%';
  };
  const appendLog = (msg: string, level: 'info' | 'warn' | 'error' = 'info') => {
    if (!logEl) return;
    const prefix = level === 'error' ? '[err] ' : level === 'warn' ? '[warn] ' : '';
    logEl.textContent += prefix + msg + '\n';
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
      <p>${t('upload.intro', {}) || 'OAuth-Flow startet im Browser. Nach Login wird der Token an die App zurückgegeben.'}</p>
      <div class="btn-row">
        <button id="btn-auth" class="btn btn-primary">${state.authToken ? (t('upload.send', {}) || 'Bundle hochladen') : (t('upload.auth', {}) || 'Im Browser anmelden')}</button>
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
  $('#btn-auth')?.addEventListener('click', async () => {
    if (!state.authToken) {
      await doAuthenticate();
      return;
    }
    await doUpload();
  });
}

async function doAuthenticate(): Promise<void> {
  setAuthStatus('warte auf Browser-Login…', 'warn');
  const r = await window.sc.authenticate();
  if (!r.ok || !r.accessToken) {
    setAuthStatus(`Fehler: ${r.error ?? 'unbekannt'}`, 'error');
    return;
  }
  state.authToken = r.accessToken;
  setAuthStatus(`angemeldet als ${r.userEmail ?? 'unbekannt'} — klick Upload, um zu senden`, 'ok');
  render();
}

async function doUpload(): Promise<void> {
  if (!state.authToken || !state.lastResult) return;
  const result = state.lastResult;
  setAuthStatus('Upload läuft…', 'warn');
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
    setAuthStatus(`Upload-Fehler: ${r.error ?? 'unbekannt'}`, 'error');
    return;
  }
  setAuthStatus(`Upload OK · bundle_id ${r.bundleId ?? '—'}`, 'ok');
  paintDiffSummary(r.diffSummary);
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

void init();
