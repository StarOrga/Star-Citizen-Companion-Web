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

  render();
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
    <p class="warn" style="margin-top: 12px;">
      ⚠ Phase 1: Extraction-Engine ist Stub — siehe README. Echte P4K-Parser kommt mit Phase 2.
    </p>
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
  // Phase 1: fake-tick the UI so the user can see the layout.
  void simulateRun();
}

async function simulateRun(): Promise<void> {
  const bar = $('#bar') as HTMLElement | null;
  const phase = $('#phase-label');
  const log = $('#log');
  const counters = $('#counters');
  const setBar = (pct: number) => {
    if (bar) bar.style.width = pct + '%';
  };
  const appendLog = (msg: string) => {
    if (!log) return;
    log.textContent += msg + '\n';
    log.scrollTop = log.scrollHeight;
  };
  const phases = ['discover', 'plan', 'extract', 'validate', 'bundle'];
  for (let i = 0; i < phases.length; i++) {
    if (phase) phase.textContent = phases[i] as string;
    appendLog(`[phase] ${phases[i]}`);
    for (let j = 0; j < 5; j++) {
      setBar(Math.round(((i * 5 + j) / (phases.length * 5)) * 100));
      appendLog(`  · tick ${j + 1}/5`);
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  setBar(100);
  if (counters) {
    counters.innerHTML = `
      <div class="counter"><div class="label">Ships</div><div class="value">60</div></div>
      <div class="counter"><div class="label">Items</div><div class="value">0</div></div>
      <div class="counter"><div class="label">Weapons</div><div class="value">0</div></div>
      <div class="counter"><div class="label">Strings</div><div class="value">0</div></div>
    `;
  }
  ($('#btn-to-upload') as HTMLButtonElement | null)?.removeAttribute('disabled');
}

// ============= View: Auth-Upload =============

function renderAuthUpload(): string {
  return `
    <h1>${t('upload.title', {}) || 'Upload'}</h1>
    <div class="card">
      <p>${t('upload.intro', {}) || 'OAuth-Flow startet im Browser. Nach Login wird der Token an die App zurückgegeben.'}</p>
      <div class="btn-row">
        <button id="btn-auth" class="btn btn-primary">${t('upload.auth', {}) || 'Im Browser anmelden'}</button>
      </div>
      <p id="auth-status" class="warn" style="margin-top: 10px;"></p>
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
    setAuthStatus('warte auf Browser-Login…', 'warn');
    const r = await window.sc.authenticate();
    if (!r.ok) {
      setAuthStatus(`Fehler: ${r.error ?? 'unbekannt'}`, 'error');
      return;
    }
    setAuthStatus(`angemeldet als ${r.userEmail ?? 'unbekannt'} — Upload-Schritt Phase 2`, 'ok');
  });
}

function setAuthStatus(msg: string, cls: 'ok' | 'warn' | 'error'): void {
  const el = $('#auth-status');
  if (!el) return;
  el.textContent = msg;
  el.className = cls;
}

void init();
