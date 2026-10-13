/**
 * App-behaviour Settings dialog (⚙, Ctrl+,) — a modal, in two sections:
 *
 * - "Wann er arbeitet": ONE sentence with three slots — when the uploader
 *   starts (`autoStart`), the preset a run it starts itself begins with
 *   (`autoRunPreset`) and what it does afterwards (`afterAutoRun`). Uploading a
 *   new patch has no switch: it always happens once the uploader runs and a
 *   session exists (`lib/auto-run.ts`).
 * - "App": chips for language, ✕-to-tray, error reports and — admins and
 *   collaborators only — the update ring.
 *
 * Every slot and chip opens the same app-styled menu (`openSlotMenu`): arrow
 * keys, Home/End, Enter/Space, Esc closes it (and only it). A pick repaints the
 * dialog IN PLACE and keeps focus on the slot it came from — the dialog is
 * never closed and reopened, not even for a language change.
 *
 * A run the operator starts by hand has its own knob, the ⏻ "when done" chip
 * on the run card; the performance dock at the bottom steers every run.
 */

import { t, setLocale, getLocale, LOCALES, type LocaleId } from '../lib/i18n.js';
import { escapeHtml } from './dom.js';
import type { PublicSettings } from './main.js';

export interface SettingsDialogCtx {
  getSettings: () => PublicSettings | null;
  patch: (partial: Partial<Omit<PublicSettings, 'telemetryEnabled'>>) => Promise<PublicSettings>;
  setTelemetry: (enabled: boolean) => Promise<PublicSettings>;
  getRole: () => 'admin' | 'collaborator' | 'viewer' | null;
  allowedChannels: () => Array<'alpha' | 'beta' | 'stable'>;
  onSettingsChanged: (next: PublicSettings) => void;
  onLocaleChanged: () => void;
}

interface MenuOption {
  value: string;
  label: string;
  desc?: string;
}

interface MenuSpec {
  label: string;
  options: MenuOption[];
  current: string;
  hint?: string;
  onPick: (value: string) => void;
}

let openInstance: (() => void) | null = null;
let closeMenu: (() => void) | null = null;
/** Cached once — the version never changes while the app runs. */
let toolVersion: string | null = null;

export function isSettingsDialogOpen(): boolean {
  return document.getElementById('sc-settings-overlay') !== null;
}

export function closeSettingsDialog(): void {
  if (openInstance) openInstance();
  else document.getElementById('sc-settings-overlay')?.remove();
}

const PRESETS: PublicSettings['autoRunPreset'][] = ['gaming', 'balanced', 'full'];
const AFTER: PublicSettings['afterAutoRun'][] = ['keep', 'quit', 'shutdown'];

function slot(key: string, text: string, quiet = false): string {
  return `<button type="button" class="settings-slot${quiet ? ' settings-slot--quiet' : ''}" data-focus="${key}" data-menu="${key}" aria-haspopup="listbox" aria-expanded="false">${escapeHtml(text)}<span class="settings-slot-caret" aria-hidden="true">▾</span></button>`;
}

function chip(key: string, text: string, hot = false): string {
  return `<button type="button" class="settings-chip${hot ? ' settings-chip--hot' : ''}" data-focus="${key}" data-menu="${key}" aria-haspopup="listbox" aria-expanded="false">${text}<span class="settings-slot-caret" aria-hidden="true">▾</span></button>`;
}

const onOff = (on: boolean): string => t(on ? 'settings.on' : 'settings.off');

function bodyHtml(s: PublicSettings, rings: Array<'alpha' | 'beta' | 'stable'>): string {
  const startSlot = slot(
    'start',
    t(s.autoStart ? 'settings.start.withWindows' : 'settings.start.manual'),
    !s.autoStart,
  );
  const presetSlot = slot('preset', t('res.preset.' + s.autoRunPreset));
  const afterSlot = slot('after', t('settings.after.' + s.afterAutoRun));
  // The translated sentence carries the three slots as placeholders; the
  // dictionaries are ours, the slot markup escapes its own text.
  const sentence = t(s.autoStart ? 'settings.when.sentenceAuto' : 'settings.when.sentenceManual', {
    start: startSlot,
    preset: presetSlot,
    after: afterSlot,
  });
  const note = !s.autoStart
    ? t('settings.when.noteManual')
    : s.afterAutoRun === 'keep'
      ? t('settings.when.noteAutoKeep')
      : t('settings.when.noteAuto');

  const ring =
    rings.length >= 2
      ? chip(
          'ring',
          `◆ ${escapeHtml(t('settings.updateChannel.label'))}: ${escapeHtml(t('settings.updateChannel.' + s.updateChannel))} · ${escapeHtml(t('settings.adminBadge'))}`,
          true,
        )
      : '';

  return `
      <div class="sc-settings-head">
        <h2 class="sc-modal-title" id="sc-settings-title">${t('settings.title')}</h2>
        <button type="button" class="sc-icon-btn" id="set-close" data-focus="close" data-tip="${t('common.dismiss')}" data-tip-key="Esc" data-tip-tier="label" aria-label="${t('common.dismiss')}">✕</button>
      </div>

      <section class="settings-section">
        <h3 class="settings-section-title">${t('settings.when.title')}</h3>
        <p class="settings-sentence">${sentence}</p>
        <p class="settings-row-hint">${note}</p>
      </section>

      <section class="settings-section">
        <h3 class="settings-section-title">${t('settings.app.title')}</h3>
        <div class="settings-chips">
          ${chip('lang', `${escapeHtml(t('settings.language'))}: ${getLocale().toUpperCase()}`)}
          ${chip('tray', `✕ ${escapeHtml(t('settings.app.tray'))}: ${escapeHtml(onOff(s.minimizeToTray))}`)}
          ${chip('telemetry', `${escapeHtml(t('settings.app.telemetry'))}: ${escapeHtml(onOff(s.telemetryEnabled))}`)}
          ${ring}
        </div>
      </section>

      <p class="settings-foot">${t('settings.footer', { version: toolVersion ?? '…' })}</p>
  `;
}

/**
 * The menu every slot and chip opens: an app-styled listbox under its anchor,
 * fully keyboard operable. Returns focus to the anchor when it closes without
 * a pick (a pick repaints and refocuses the anchor itself).
 */
function openSlotMenu(anchor: HTMLElement, spec: MenuSpec): void {
  closeMenu?.();
  const menu = document.createElement('div');
  menu.className = 'sc-popover settings-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', spec.label);
  menu.innerHTML =
    spec.options
      .map(
        (o) =>
          `<button type="button" class="settings-opt${o.value === spec.current ? ' is-on' : ''}" role="option" aria-selected="${o.value === spec.current ? 'true' : 'false'}" data-value="${escapeHtml(o.value)}"><b>${escapeHtml(o.label)}</b>${o.desc ? `<small>${escapeHtml(o.desc)}</small>` : ''}</button>`,
      )
      .join('') + (spec.hint ? `<p class="settings-menu-hint">${escapeHtml(spec.hint)}</p>` : '');
  document.body.appendChild(menu);
  anchor.setAttribute('aria-expanded', 'true');

  const rect = anchor.getBoundingClientRect();
  const below = rect.bottom + 6;
  const fitsBelow = below + menu.offsetHeight <= window.innerHeight - 8;
  menu.style.top = `${fitsBelow ? below : Math.max(8, rect.top - 6 - menu.offsetHeight)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;

  const opts = Array.from(menu.querySelectorAll<HTMLButtonElement>('.settings-opt'));
  (opts.find((b) => b.dataset['value'] === spec.current) ?? opts[0])?.focus();

  const dismiss = (refocus: boolean): void => {
    menu.remove();
    document.removeEventListener('mousedown', onDocDown, true);
    anchor.setAttribute('aria-expanded', 'false');
    closeMenu = null;
    if (refocus) anchor.focus();
  };
  const onDocDown = (e: MouseEvent): void => {
    if (menu.contains(e.target as Node)) return;
    dismiss(anchor.contains(e.target as Node));
  };
  document.addEventListener('mousedown', onDocDown, true);
  closeMenu = () => dismiss(true);

  const pick = (btn: HTMLButtonElement): void => {
    const value = btn.dataset['value'];
    dismiss(false);
    if (value !== undefined && value !== spec.current) spec.onPick(value);
    else anchor.focus();
  };
  opts.forEach((btn) => btn.addEventListener('click', () => pick(btn)));
  menu.addEventListener('keydown', (e) => {
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number): void => {
      e.preventDefault();
      opts[(to + opts.length) % opts.length]?.focus();
    };
    if (e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(opts.length - 1);
    else if (e.key === 'Tab') dismiss(true);
  });
}

/** Global entry point — Ctrl+, and the gear button both call this. */
export function openSettingsDialog(ctx: SettingsDialogCtx): void {
  if (isSettingsDialogOpen()) return;
  if (!ctx.getSettings()) return;

  const overlay = document.createElement('div');
  overlay.id = 'sc-settings-overlay';
  overlay.className = 'sc-modal-overlay sc-sheet-overlay';
  const dialog = document.createElement('div');
  dialog.className = 'sc-modal sc-settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'sc-settings-title');
  overlay.appendChild(dialog);

  const returnFocus = document.activeElement as HTMLElement | null;

  const apply = async (
    focusKey: string,
    change: () => Promise<PublicSettings>,
  ): Promise<void> => {
    const next = await change();
    ctx.onSettingsChanged(next);
    paint(focusKey);
  };

  const menus = (key: string, s: PublicSettings): MenuSpec | null => {
    switch (key) {
      case 'start':
        return {
          label: t('settings.start.label'),
          current: s.autoStart ? 'on' : 'off',
          options: [
            { value: 'on', label: t('settings.start.withWindows'), desc: t('settings.start.withWindowsDesc') },
            { value: 'off', label: t('settings.start.manual'), desc: t('settings.start.manualDesc') },
          ],
          onPick: (v) => void apply(key, () => ctx.patch({ autoStart: v === 'on' })),
        };
      case 'preset':
        return {
          label: t('settings.preset.label'),
          current: s.autoRunPreset,
          options: PRESETS.map((p) => ({ value: p, label: t('res.preset.' + p), desc: t('res.preset.' + p + 'Desc') })),
          hint: t('settings.preset.hint'),
          onPick: (v) =>
            void apply(key, () => ctx.patch({ autoRunPreset: v as PublicSettings['autoRunPreset'] })),
        };
      case 'after':
        return {
          label: t('settings.after.label'),
          current: s.afterAutoRun,
          options: AFTER.map((a) => ({ value: a, label: t('settings.after.' + a), desc: t('settings.after.' + a + 'Desc') })),
          hint: t('settings.after.hint'),
          onPick: (v) =>
            void apply(key, () => ctx.patch({ afterAutoRun: v as PublicSettings['afterAutoRun'] })),
        };
      case 'lang':
        return {
          label: t('settings.language'),
          current: getLocale(),
          options: LOCALES.map((l) => ({ value: l, label: l.toUpperCase(), desc: t('settings.languageName.' + l) })),
          onPick: (v) => {
            const loc = v as LocaleId;
            void setLocale(loc).then(async () => {
              ctx.onLocaleChanged();
              paint(key);
              const next = await ctx.patch({ language: loc });
              ctx.onSettingsChanged(next);
            });
          },
        };
      case 'tray':
        return {
          label: t('settings.app.tray'),
          current: s.minimizeToTray ? 'on' : 'off',
          options: [
            { value: 'on', label: t('settings.on'), desc: t('tray.minimizeHint') },
            { value: 'off', label: t('settings.off'), desc: t('settings.app.trayOffDesc') },
          ],
          onPick: (v) => void apply(key, () => ctx.patch({ minimizeToTray: v === 'on' })),
        };
      case 'telemetry':
        return {
          label: t('settings.app.telemetry'),
          current: s.telemetryEnabled ? 'on' : 'off',
          options: [
            { value: 'on', label: t('settings.on'), desc: t('telemetry.hint') },
            { value: 'off', label: t('settings.off'), desc: t('settings.app.telemetryOffDesc') },
          ],
          onPick: (v) => void apply(key, () => ctx.setTelemetry(v === 'on')),
        };
      case 'ring':
        return {
          label: t('settings.updateChannel.label'),
          current: s.updateChannel,
          options: ctx.allowedChannels().map((c) => ({ value: c, label: t('settings.updateChannel.' + c) })),
          hint: `${t('settings.updateChannel.hint')} — ${t('settings.adminOnly')}`,
          onPick: (v) =>
            void apply(key, () => ctx.patch({ updateChannel: v as PublicSettings['updateChannel'] })),
        };
      default:
        return null;
    }
  };

  /** (Re)paint the dialog's content in place, focus back on `focusKey`. */
  function paint(focusKey?: string): void {
    const s = ctx.getSettings();
    if (!s) return;
    dialog.innerHTML = bodyHtml(s, ctx.allowedChannels());
    dialog.querySelector('#set-close')?.addEventListener('click', close);
    dialog.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cur = ctx.getSettings();
        const spec = cur ? menus(btn.dataset['menu'] ?? '', cur) : null;
        if (spec) openSlotMenu(btn, spec);
      });
    });
    if (focusKey) dialog.querySelector<HTMLElement>(`[data-focus="${focusKey}"]`)?.focus();
  }

  const close = (): void => {
    closeMenu?.();
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    openInstance = null;
    returnFocus?.focus?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Esc closes the open menu first, the dialog only on the next press.
      e.preventDefault();
      e.stopPropagation();
      if (closeMenu) closeMenu();
      else close();
      return;
    }
    if (e.key === 'Tab' && !closeMenu) {
      // Keep Tab inside the dialog while it is open.
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button'));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);
  openInstance = close;
  paint('close');

  if (toolVersion === null) {
    void window.sc.env().then((env) => {
      toolVersion = env.toolVersion;
      const foot = dialog.querySelector('.settings-foot');
      if (foot) foot.textContent = t('settings.footer', { version: toolVersion });
    });
  }
}

/** Used by the keymap (Esc) so it doesn't need to know the DOM id. */
export function closeSettingsDialogIfOpen(): boolean {
  if (!openInstance) return false;
  openInstance();
  return true;
}
