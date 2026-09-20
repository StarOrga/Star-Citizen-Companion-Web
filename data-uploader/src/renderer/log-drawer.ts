/**
 * Collapsible log drawer under the Extract/Upload card. By default only the
 * last log line shows (dim, under the card); Ctrl+L expands the full
 * transcript with a copy-to-clipboard button. Expects the host step to render
 * `#log-lastline`, `#log-drawer` (hidden), `#log-drawer-body` and
 * `#log-drawer-copy` — see `steps/run.ts`.
 */

import { t } from '../lib/i18n.js';

export type LogLevel = 'info' | 'success' | 'warn' | 'error';

let lines: { text: string; level: LogLevel }[] = [];
let plainText = '';

export function resetLog(): void {
  lines = [];
  plainText = '';
  const last = document.getElementById('log-lastline');
  if (last) last.textContent = '';
  const body = document.getElementById('log-drawer-body');
  if (body) body.innerHTML = '';
}

export function appendLog(msg: string, level: LogLevel = 'info'): void {
  const prefix = level === 'error' ? '[err] ' : level === 'warn' ? '[warn] ' : '';
  const text = prefix + msg;
  lines.push({ text, level });
  plainText += text + '\n';

  const last = document.getElementById('log-lastline');
  if (last) {
    last.textContent = text;
    last.className = `log-lastline log-${level}`;
  }
  const body = document.getElementById('log-drawer-body');
  if (body) {
    const line = document.createElement('div');
    line.className = `log-line log-${level}`;
    line.textContent = text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }
}

export function isLogDrawerOpen(): boolean {
  const drawer = document.getElementById('log-drawer');
  return !!drawer && !drawer.hidden;
}

export function toggleLogDrawer(): void {
  const drawer = document.getElementById('log-drawer');
  if (!drawer) return;
  drawer.hidden = !drawer.hidden;
}

export function closeLogDrawer(): boolean {
  const drawer = document.getElementById('log-drawer');
  if (!drawer || drawer.hidden) return false;
  drawer.hidden = true;
  return true;
}

/** Wire the copy button once per mount (call from the host step's wire fn). */
export function wireLogDrawer(): void {
  const copyBtn = document.getElementById('log-drawer-copy') as HTMLButtonElement | null;
  const toggleBtn = document.getElementById('log-drawer-toggle') as HTMLButtonElement | null;
  toggleBtn?.addEventListener('click', () => toggleLogDrawer());
  copyBtn?.addEventListener('click', () => {
    void window.sc.clipboard.writeText(plainText).then(() => {
      copyBtn.textContent = t('run.copied');
      setTimeout(() => {
        copyBtn.textContent = t('run.copyLog');
      }, 1600);
    });
  });
}
