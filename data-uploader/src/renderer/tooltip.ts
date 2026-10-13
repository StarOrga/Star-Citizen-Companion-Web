/**
 * The uploader's own tooltip — replaces the native `title` attribute, which
 * renders in the OS look, cannot be delayed and never opens on keyboard focus.
 *
 * Markup contract (any element, including ones rendered later):
 *   data-tip="…"            the text (already localized by the caller)
 *   data-tip-key="Space"    optional hotkey, shown as a key badge in the tip —
 *                           the one place hotkey hints live, so buttons no
 *                           longer carry a permanent <kbd> badge
 *   data-tip-title="…"      optional bold first line (a state such as "held back")
 *   data-tip-nums="…"       optional live numbers: rows split by a newline,
 *                           cells by a tab, first row = column heads; drawn as a grid in a
 *                           fixed-width tip. The caller pads values to a fixed
 *                           width, so {@link refreshTooltip} can rewrite them in
 *                           place while the tip is open without it jumping.
 *   data-tip-tier="label"   only when the tip is the element's only name
 *                           (icon-only control), shows truncated content, or
 *                           says why a control is disabled. Default: info.
 *
 * Behaviour: info opens after 1500 ms, label after 500 ms; within 300 ms of a
 * tip closing the next one opens at once; keyboard focus opens instantly; the
 * pointer may move onto the tip without closing it; Escape closes it.
 *
 * One delegated listener set on `document`, so views that re-render their
 * markup need no wiring. A `title` attribute that still slips in (a library,
 * a template edit) is converted to `data-tip` on first hover, so the native
 * tooltip never shows.
 */

const DELAY = { info: 1500, label: 500 } as const;
const SKIP_MS = 300;
const GAP_PX = 6;

let tipEl: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let openTimer = 0;
let closeTimer = 0;
let lastClose = 0;
let viaKeyboard = false;

function trigger(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const titled = node.closest<HTMLElement>('[title]');
  if (titled && titled.title) {
    titled.dataset.tip = titled.title;
    titled.removeAttribute('title');
  }
  return node.closest<HTMLElement>('[data-tip]');
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function place(el: HTMLElement): void {
  if (!tipEl) return;
  const r = el.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  let top = r.top - h - GAP_PX;
  if (top < 4) top = r.bottom + GAP_PX;
  const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 4));
  tipEl.style.top = `${Math.round(top)}px`;
  tipEl.style.left = `${Math.round(left)}px`;
}

function numsHtml(nums: string): string {
  const rows = nums.split('\n').map((r) => r.split('\t'));
  const cols = Math.max(...rows.map((r) => r.length));
  const cells = rows
    .map((r, i) =>
      Array.from({ length: cols }, (_, c) => {
        const tag = i === 0 || c === 0 ? 'span' : 'b';
        const cls = i === 0 && c > 0 ? ' class="sc-tip-h"' : '';
        return `<${tag}${cls}>${escapeText(r[c] ?? '')}</${tag}>`;
      }).join(''),
    )
    .join('');
  return `<span class="sc-tip-nums" style="grid-template-columns: auto repeat(${cols - 1}, max-content)">${cells}</span>`;
}

/** What the tip shows for an element; the signature tells whether a repaint must re-place it. */
function content(el: HTMLElement): { html: string; shape: string } {
  const text = el.dataset.tip ?? '';
  const key = el.dataset.tipKey ?? '';
  const title = el.dataset.tipTitle ?? '';
  const nums = el.dataset.tipNums ?? '';
  const body =
    (title ? `<strong class="sc-tip-title">${escapeText(title)}</strong>` : '') +
    `<span class="sc-tip-text">${escapeText(text)}</span>` +
    (nums ? numsHtml(nums) : '');
  const html =
    (title || nums ? `<span class="sc-tip-body">${body}</span>` : body) +
    (key ? `<kbd class="sc-kbd">${escapeText(key)}</kbd>` : '');
  return { html, shape: [title, text, key].join('\n') };
}

let shownShape = '';

function show(el: HTMLElement): void {
  const text = el.dataset.tip ?? '';
  const key = el.dataset.tipKey ?? '';
  if (!tipEl || (!text && !key)) return;
  owner = el;
  const c = content(el);
  tipEl.classList.toggle('sc-tooltip--nums', Boolean(el.dataset.tipNums));
  tipEl.innerHTML = c.html;
  shownShape = c.shape;
  tipEl.hidden = false;
  place(el);
  if (!el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', 'sc-tooltip');
}

/**
 * Repaint an open tip from its owner's current data attributes — for live
 * numbers. Only a changed text or title re-places it; numbers alone are padded
 * to fixed widths by the caller and update in place.
 */
export function refreshTooltip(): void {
  if (!owner || !tipEl || tipEl.hidden) return;
  if (!owner.isConnected) {
    hideTooltip();
    return;
  }
  const c = content(owner);
  if (tipEl.innerHTML === c.html) return;
  tipEl.innerHTML = c.html;
  if (c.shape !== shownShape) {
    shownShape = c.shape;
    place(owner);
  }
}

export function hideTooltip(): void {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  if (!owner || !tipEl) return;
  if (owner.getAttribute('aria-describedby') === 'sc-tooltip') owner.removeAttribute('aria-describedby');
  owner = null;
  tipEl.hidden = true;
  lastClose = Date.now();
}

function schedule(el: HTMLElement, immediate: boolean): void {
  window.clearTimeout(openTimer);
  window.clearTimeout(closeTimer);
  if (owner === el) return;
  if (owner) hideTooltip();
  const tier = el.dataset.tipTier === 'label' ? 'label' : 'info';
  const wait = immediate || Date.now() - lastClose < SKIP_MS ? 0 : DELAY[tier];
  openTimer = window.setTimeout(() => {
    // The element may have been re-rendered away while we waited.
    if (el.isConnected) show(el);
  }, wait);
}

export function initTooltips(): void {
  if (tipEl) return;
  tipEl = document.createElement('div');
  tipEl.id = 'sc-tooltip';
  tipEl.className = 'sc-tooltip';
  tipEl.setAttribute('role', 'tooltip');
  tipEl.hidden = true;
  document.body.appendChild(tipEl);

  document.addEventListener('pointerover', (e) => {
    if (tipEl?.contains(e.target as Node)) {
      window.clearTimeout(closeTimer);
      return;
    }
    const el = trigger(e.target);
    if (el) schedule(el, false);
  });
  document.addEventListener('pointerout', (e) => {
    const to = e.relatedTarget as Node | null;
    if (to && (tipEl?.contains(to) || owner?.contains(to))) return;
    if (!trigger(e.target) && !tipEl?.contains(e.target as Node)) return;
    window.clearTimeout(openTimer);
    if (owner) closeTimer = window.setTimeout(hideTooltip, 120);
  });
  document.addEventListener('focusin', (e) => {
    const el = trigger(e.target);
    if (el && viaKeyboard) schedule(el, true);
  });
  document.addEventListener('focusout', () => hideTooltip());
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && owner) hideTooltip();
      else viaKeyboard = true;
    },
    true,
  );
  document.addEventListener(
    'pointerdown',
    () => {
      viaKeyboard = false;
      hideTooltip();
    },
    true,
  );
  // A tip pinned to a scrolled or re-laid-out element would float detached.
  window.addEventListener('scroll', () => hideTooltip(), true);
  window.addEventListener('resize', () => hideTooltip());
}
