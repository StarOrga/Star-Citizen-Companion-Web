/**
 * Step 2 — Setup. One choice only: the speed (how hard the PC is loaded —
 * minimal / standard / maximum), owned by main, persisted, and switchable
 * mid-run via the throttle chip. Every run extracts the full data set — there is no scope choice,
 * so what lands on the server never depends on which uploader produced it.
 * Plus a "Laufoptionen" button opening the options sheet (when-done). The
 * sheet auto-opens on the very first run of a freshly selected install;
 * otherwise Enter starts the run directly.
 */

import { t } from '../../lib/i18n.js';
import { $ } from '../dom.js';
import { openOptionsSheet } from '../options-sheet.js';
import { buildRunPlan } from '../../lib/run-plan.js';
import { state, startRun, openAppSettingsDialog, armedChipHtml, wireArmedChip, applyProfile } from '../main.js';
import type { LiveProfile } from '../throttle-chip.js';

/** The speed (load) modes the operator can pick; `auto` stays internal. */
const SPEED_PROFILES: Array<Exclude<LiveProfile, 'auto'>> = ['minimal', 'standard', 'maximum'];

/** Installs the operator has already seen the options sheet for this session. */
const seenInstalls = new Set<string>();

function installKey(): string {
  const ch = state.channels.find((c) => c.selected);
  return ch ? `${ch.channel}:${ch.dataP4kPath}` : '';
}

export function renderSetup(): string {
  return `
    <div class="view step-setup">
      <h1>${t('configure.title')} ${armedChipHtml()}</h1>
      <p class="view-intro">${t('configure.subtitle')}</p>
      <div class="setup-sections view-body">
        <p class="setup-hint">${t('configure.speed.hint')}</p>
        <div class="speed-pills" id="speed-pills-mount"></div>
      </div>
      <div class="btn-row view-footer">
        <button id="btn-run-options" type="button" class="btn">${t('sheet.title')}</button>
        <button id="btn-open-settings" class="btn" data-tip="${t('settings.title')}" data-tip-key="Ctrl+,">⚙ ${t('settings.title')}</button>
        <button id="btn-start-run" class="btn btn-primary" data-tip="${t('configure.start')}" data-tip-key="Enter">${t('configure.start')}</button>
      </div>
    </div>
  `;
}

export function wireSetup(): void {
  paintSpeedPills();
  wireArmedChip();
  $('#btn-run-options')?.addEventListener('click', () => openSheet());
  $('#btn-open-settings')?.addEventListener('click', () => openAppSettingsDialog());
  $('#btn-start-run')?.addEventListener('click', () => void beginRun());

  // Auto-open the sheet on the very first run of this install this session.
  const key = installKey();
  if (key && !seenInstalls.has(key)) {
    seenInstalls.add(key);
    openSheet();
  }
}

/** Enter on this step: open the sheet if unseen, otherwise start straight away. */
export function primaryAction(): void {
  const key = installKey();
  if (key && !seenInstalls.has(key)) {
    seenInstalls.add(key);
    openSheet();
    return;
  }
  void beginRun();
}

function openSheet(): void {
  openOptionsSheet({
    getWhenDone: () => state.whenDone,
    setWhenDone: (v) => {
      state.whenDone = v;
    },
    openSettings: () => openAppSettingsDialog(),
    onChange: () => {
      const h1 = document.querySelector('.step-setup h1');
      if (h1) {
        h1.innerHTML = `${t('configure.title')} ${armedChipHtml()}`;
        wireArmedChip();
      }
    },
  });
}

async function beginRun(): Promise<void> {
  const channel = state.channels.find((c) => c.selected);
  if (!channel || !state.settings) return;
  const plan = buildRunPlan({
    channel: channel.channel as 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW',
    settings: state.settings,
    signedIn: Boolean(state.authToken),
    whenDone: state.whenDone,
  });
  await startRun(plan);
}

function paintSpeedPills(): void {
  const mount = $('#speed-pills-mount');
  if (!mount) return;
  const cur = state.profile === 'auto' ? 'standard' : state.profile;
  mount.innerHTML = SPEED_PROFILES.map((id) => {
    const active = id === cur ? 'active' : '';
    return `
      <div class="profile-pill ${active}" data-speed="${id}" tabindex="0" role="button" aria-pressed="${active ? 'true' : 'false'}">
        <span class="name">${t('speed.' + id)}</span>
        <span class="desc">${t('speed.' + id + 'Desc')}</span>
      </div>`;
  }).join('');
  wirePills(mount, async (id) => {
    await applyProfile(id as LiveProfile);
    paintSpeedPills();
  });
}

/** Click + Enter/Space on a pill row; keeps keyboard focus on the picked pill across the repaint. */
function wirePills(mount: HTMLElement, pick: (id: string) => Promise<void>): void {
  mount.querySelectorAll<HTMLElement>('.profile-pill').forEach((el) => {
    const choose = (): void => {
      const id = el.dataset['speed'];
      if (!id) return;
      const hadFocus = document.activeElement === el;
      void pick(id).then(() => {
        if (hadFocus) $(`.profile-pill[data-speed="${id}"]`)?.focus();
      });
    };
    el.addEventListener('click', choose);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        // Handled here — the global Enter (= start the run) must not fire too.
        e.preventDefault();
        choose();
      }
    });
  });
}

