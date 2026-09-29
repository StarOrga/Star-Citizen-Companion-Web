import { isPlainLeftClick } from '../core/modified-click.util';

/**
 * Skip link handler: moves focus to `<main id="sc-main">` without touching the
 * URL. preventDefault keeps `#sc-main` out of the address bar and keeps the
 * router's anchorScrolling out of it. Enter on a link fires a click with
 * button 0 and takes the same path; a modified click falls through untouched.
 */
export function skipToMain(ev: MouseEvent): void {
  if (!isPlainLeftClick(ev)) return;
  ev.preventDefault();
  document.getElementById('sc-main')?.focus();
}
