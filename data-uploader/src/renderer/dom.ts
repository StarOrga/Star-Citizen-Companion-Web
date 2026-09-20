/** Tiny DOM helpers shared by main.ts and every shell/steps/* module. */

export const $ = (sel: string): HTMLElement | null => document.querySelector(sel);

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}
