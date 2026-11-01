import type { FeedbackAreaView } from './feedback-area.types';
import type { FeedbackSpot, FeedbackSpotLabel } from './feedback-spot.service';

type Translate = (key: string, params?: Record<string, string>) => string;

/** Longest element name quoted in a reference line, characters. */
const NAME_MAX = 60;

/** Parts of the app that are the feedback UI itself — never a reference. */
const FEEDBACK_UI = 'sc-feedback-fab, sc-user-feedback-fab, sc-feedback-capture, [data-sc-capture-hide]';

/** Fields where a plain Ctrl+click means something (caret, selection, toggle). */
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * Is this click the admin's "point at this" gesture (feedback #243)?
 *
 *   - Alt+click (Option+click on a Mac): captures everywhere, links included.
 *     It has no meaning in the app, and the capture listener cancels the
 *     browser's own alt-click (download a link).
 *   - Ctrl+click: captures only where it does nothing else — NOT inside a
 *     link (Ctrl+click opens it in a new tab, the project's navigation rule)
 *     and not in a text field. Ctrl+Alt is skipped on purpose: on a German
 *     keyboard that is AltGr.
 *
 * Clicks inside the feedback UI itself never capture.
 */
export function isCaptureClick(ev: MouseEvent, target: Element | null): boolean {
  if (ev.button !== 0 || !target || ev.shiftKey || ev.defaultPrevented) return false;
  if (target.closest(FEEDBACK_UI)) return false;
  if (ev.altKey) return !ev.ctrlKey;
  if (ev.ctrlKey && !ev.metaKey) return !target.closest(`a[href], area[href], ${FIELD}`);
  return false;
}

/** The innermost marked section holding `target`, or null. */
export function spotFor(spots: readonly FeedbackSpot[], target: Element): FeedbackSpot | null {
  let best: FeedbackSpot | null = null;
  for (const spot of spots) {
    if (!spot.el.contains(target)) continue;
    if (!best || best.el.contains(spot.el)) best = spot;
  }
  return best;
}

const MEANINGFUL =
  'a[href], button, summary, input, select, textarea, label, img, svg, h1, h2, h3, h4, h5, h6, ' +
  '[role], [aria-label], [data-testid]';

/** The element worth naming: the nearest control / heading / image, else the target. */
export function meaningfulElement(target: Element): Element {
  return target.closest(MEANINGFUL) ?? target;
}

export type CaptureRole =
  | 'link' | 'button' | 'field' | 'select' | 'checkbox' | 'radio' | 'heading' | 'image'
  | 'tab' | 'section' | 'label' | 'element';

export function roleOf(el: Element): CaptureRole {
  const explicit = el.getAttribute('role');
  if (explicit === 'tab') return 'tab';
  if (explicit === 'button') return 'button';
  if (explicit === 'link') return 'link';
  if (explicit === 'checkbox' || explicit === 'switch') return 'checkbox';
  if (explicit === 'radio') return 'radio';
  if (explicit === 'heading') return 'heading';
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'summary') return 'section';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'field';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    return 'field';
  }
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'img' || tag === 'svg') return 'image';
  if (tag === 'label') return 'label';
  return 'element';
}

function squash(text: string | null | undefined): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > NAME_MAX ? `${t.slice(0, NAME_MAX - 1).trimEnd()}…` : t;
}

/**
 * What the element is called: aria-label, aria-labelledby, alt, a field's
 * label or placeholder, else its visible text. Never a field's typed value.
 */
export function nameOf(el: Element): string {
  const aria = squash(el.getAttribute('aria-label'));
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = squash(
      by
        .split(/\s+/)
        .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' '),
    );
    if (text) return text;
  }
  const alt = squash(el.getAttribute('alt'));
  if (alt) return alt;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    const labels = (el as HTMLInputElement).labels;
    const fromLabel = squash(labels ? [...labels].map((l) => l.textContent).join(' ') : '');
    if (fromLabel) return fromLabel;
    if (tag !== 'select') {
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if (type === 'button' || type === 'submit') return squash(el.getAttribute('value'));
    }
    return squash(el.getAttribute('placeholder') ?? el.getAttribute('name'));
  }
  if (tag === 'svg') return squash(el.querySelector('title')?.textContent);
  const text = squash((el as HTMLElement).innerText ?? el.textContent);
  return text || squash(el.getAttribute('title'));
}

/**
 * The line a capture inserts, e.g.
 * "Klassische Ansicht: Loadout Bewaffnung › Button „Laser-Repeater S3“".
 * Area: the nearest marked section (with the Codex view in front on a ship
 * page); an unmarked part of the page falls back to the route path.
 */
export function captureLine(
  label: FeedbackSpotLabel | null,
  view: FeedbackAreaView | null,
  path: string,
  element: { role: CaptureRole; name: string },
  t: Translate,
): string {
  const where = label ? sectionLabel(label, t) : path;
  const base = view ? `${t(`codex.holo.toggle.${view}Hint`)}: ${where}` : where;
  const role = t(`feedbackCapture.role.${element.role}`);
  const what = element.name ? t('feedbackCapture.element', { role, name: element.name }) : role;
  return `${base} › ${what}`;
}

function sectionLabel(label: FeedbackSpotLabel, t: Translate): string {
  let section = t(label.key);
  if (label.subKey) section = `${section} ${t(label.subKey)}`;
  if (label.text) section = t('feedbackSpot.titled', { label: section, text: label.text });
  return section;
}
