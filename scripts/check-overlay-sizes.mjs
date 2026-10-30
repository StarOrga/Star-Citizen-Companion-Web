#!/usr/bin/env node
// ============================================================
// check-overlay-sizes.mjs — overlays take their width from a tier token
//
// WHY: popups, menus and toasts had drifted into fourteen hard widths
// (320/340/420/440/480/680/760/860/900/960/1060/1100px). styles.scss
// ("OVERLAY SIZES") now defines the tiers --sc-ov-menu / -s / -m / -area,
// --sc-toast-w, --sc-tooltip-w and --sc-feedback-dock-width.
//
// RULE: in the overlay component files below, a `width` or `max-width` with a
// literal of 240px or more fails — unless the same line carries
// `overlay-size: exception — <reason>` (the image drives the size, the box
// hangs off a field, it is not an overlay box at all). min-width and heights
// are not checked. Runs in `prebuild`.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const OVERLAY_FILES = [
  'src/app/shell/apps-menu.component.ts',
  'src/app/shell/shell.component.ts',
  'src/app/desktop/app-download-menu.component.ts',
  'src/app/social/loadout-share-panel.component.ts',
  'src/app/shared/column-menu.component.ts',
  'src/app/hangar/hangar-item-picker.component.ts',
  'src/app/shared/dialog/sc-confirm-dialog.component.ts',
  'src/app/auth/login.component.ts',
  'src/app/auth/set-password.component.ts',
  'src/app/auth/access-unavailable.component.ts',
  'src/app/desktop/desktop-auth.component.ts',
  'src/app/desktop/desktop-read-auth.component.ts',
  'src/app/codex/codex-component-modal.component.ts',
  'src/app/codex/codex-weapon-detail.component.ts',
  'src/app/shell/quick-search.component.ts',
  'src/app/admin/feedback/admin-feedback.component.ts',
  'src/app/hq/hq-supplies-popup.component.ts',
  'src/app/shared/overlay-frame/overlay-frame.component.ts',
  'src/app/news/patch-dossier.component.ts',
  'src/app/codex/upcoming-detail.component.ts',
  'src/app/codex/codex-swap-picker.component.ts',
  'src/app/codex/codex-compare-tray.component.ts',
  'src/app/shared/star-toast/star-toast.component.ts',
  'src/app/shared/undo-toast/undo-toast.component.ts',
  'src/app/desktop/app-notice.component.ts',
  'src/app/starscape/starscape-app-promo.component.ts',
  'src/app/shell/feedback-fab.component.ts',
  'src/app/shell/user-feedback-fab.component.ts',
  'src/app/shared/tooltip/sc-tooltip.component.ts',
  'src/app/shared/sc-select.component.ts',
  'src/app/shared/lightbox/lightbox.component.ts',
  'src/app/verse/pages/verse-gallery-item.component.ts',
  'src/app/shell/fusion-bar/fusion-search.component.ts',
];

const MIN_PX = 240;
const WIDTH_RE = /(?<![\w(-])(?:max-)?width\s*:\s*[^;{}]*?(?<![\w.-])(\d{3,4})px/g;

/** @returns {{line:number,text:string}[]} offending lines of one file's text */
export function findHardWidths(text) {
  const out = [];
  text.split(/\r?\n/).forEach((text, i) => {
    if (/overlay-size:\s*exception/.test(text)) return;
    for (const m of text.matchAll(WIDTH_RE)) {
      if (Number(m[1]) >= MIN_PX) {
        out.push({ line: i + 1, text: text.trim() });
        break;
      }
    }
  });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bad = 0;
  for (const rel of OVERLAY_FILES) {
    const abs = path.join(REPO_ROOT, rel);
    if (!existsSync(abs)) {
      console.error(`check-overlay-sizes: listed file is gone: ${rel}`);
      bad++;
      continue;
    }
    for (const f of findHardWidths(readFileSync(abs, 'utf8'))) {
      console.error(`${rel}:${f.line}: hard width in an overlay — use a tier token or mark "overlay-size: exception — <reason>"\n    ${f.text}`);
      bad++;
    }
  }
  if (bad) process.exitCode = 1;
  else console.log(`check-overlay-sizes: ${OVERLAY_FILES.length} overlay files, no hard widths`);
}
