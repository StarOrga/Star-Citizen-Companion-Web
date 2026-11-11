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
  '[role], [aria-label], [data-testid], [data-feedback-name]';

/**
 * Controls that swallow what is inside them: an Alt+click on the avatar image
 * inside the account button points at the button, not at a nameless "Bild"
 * (feedback #342).
 */
const INTERACTIVE =
  'a[href], button, summary, label, input, select, textarea, [data-feedback-name], ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], ' +
  '[role="menuitemradio"], [role="option"], [role="checkbox"], [role="switch"], [role="radio"]';

/**
 * The element worth naming: the nearest control holding the target, else the
 * nearest heading / image / labelled element — and when that one has no name
 * (a decorative icon), the nearest named one around it.
 */
export function meaningfulElement(target: Element): Element {
  const control = target.closest(INTERACTIVE);
  if (control) return control;
  const first = target.closest(MEANINGFUL);
  if (!first) return target;
  for (let el: Element | null = first; el; el = el.parentElement?.closest(MEANINGFUL) ?? null) {
    if (el === el.ownerDocument.body) break;
    if (nameOf(el)) return el;
  }
  return first;
}

/** One region a capture names: a marked section or a landmark of the page or shell. */
export type CaptureRegion =
  | { kind: 'spot'; label: FeedbackSpotLabel }
  | { kind: 'landmark'; key: string; name: string };

/**
 * Landmarks and overlays a click can sit in. `data-feedback-area` (an i18n
 * key) names a region that has no landmark role of its own (the beta bar).
 */
const LANDMARK =
  '[data-feedback-area], header, footer, nav, aside, dialog, [role="banner"], [role="contentinfo"], ' +
  '[role="navigation"], [role="complementary"], [role="dialog"], [role="alertdialog"], ' +
  '[role="menu"], [role="listbox"], [role="search"]';

/** A header/footer is the shell's own only outside these (as in HTML-AAM). */
const SECTIONING = 'main, article, section, aside, nav, [role="main"], [role="dialog"], [role="alertdialog"]';

function landmarkKey(el: Element): string | null {
  const own = el.getAttribute('data-feedback-area');
  if (own) return own;
  const role = el.getAttribute('role');
  const tag = el.tagName.toLowerCase();
  if (role === 'banner') return 'feedbackCapture.area.header';
  if (role === 'contentinfo') return 'feedbackCapture.area.footer';
  if (role === 'navigation' || (!role && tag === 'nav')) return 'feedbackCapture.area.navigation';
  if (role === 'complementary' || (!role && tag === 'aside')) return 'feedbackCapture.area.sidebar';
  if (role === 'dialog' || role === 'alertdialog' || (!role && tag === 'dialog')) return 'feedbackCapture.area.dialog';
  if (role === 'menu' || role === 'listbox') return 'feedbackCapture.area.menu';
  if (role === 'search') return 'feedbackCapture.area.search';
  if (!role && (tag === 'header' || tag === 'footer')) {
    if (el.parentElement?.closest(SECTIONING)) return null;
    return tag === 'header' ? 'feedbackCapture.area.header' : 'feedbackCapture.area.footer';
  }
  return null;
}

/** aria-label, else the text aria-labelledby points at. */
function labelOf(el: Element): string {
  const aria = squash(el.getAttribute('aria-label'));
  if (aria) return aria;
  const by = el.getAttribute('aria-labelledby');
  if (!by) return '';
  return squash(
    by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' '),
  );
}

/**
 * Every region around `target`, outermost first: the shell's header, a
 * navigation, a menu or dialog, and the innermost marked section. Before
 * feedback #342 a click in the header fell back to the page's route path.
 */
export function regionsFor(target: Element, spot: FeedbackSpot | null): CaptureRegion[] {
  const found: { el: Element; region: CaptureRegion }[] = [];
  for (let el = target.closest(LANDMARK); el; el = el.parentElement?.closest(LANDMARK) ?? null) {
    const key = landmarkKey(el);
    if (key) found.push({ el, region: { kind: 'landmark', key, name: labelOf(el) } });
  }
  if (spot) {
    // `found` is innermost first: the spot goes in front of the first landmark around it.
    const at = found.findIndex((f) => f.el !== spot.el && f.el.contains(spot.el));
    const entry = { el: spot.el, region: { kind: 'spot' as const, label: spot.label() } };
    if (at === -1) found.push(entry);
    else found.splice(at, 0, entry);
  }
  return found.reverse().map((f) => f.region);
}

/** Is the target part of the routed page (inside `<main>`), not the shell around it? */
export function inPage(target: Element): boolean {
  return !!target.closest('main, [role="main"]');
}

export type CaptureRole =
  | 'link' | 'button' | 'field' | 'select' | 'checkbox' | 'radio' | 'heading' | 'image'
  | 'tab' | 'section' | 'label' | 'menuitem' | 'element';

export function roleOf(el: Element): CaptureRole {
  const explicit = el.getAttribute('role');
  if (explicit === 'tab') return 'tab';
  if (explicit === 'button') return 'button';
  if (explicit === 'link') return 'link';
  if (explicit === 'checkbox' || explicit === 'switch') return 'checkbox';
  if (explicit === 'radio') return 'radio';
  if (explicit === 'heading') return 'heading';
  if (explicit === 'menuitem' || explicit === 'menuitemcheckbox' || explicit === 'menuitemradio') return 'menuitem';
  if (explicit === 'img') return 'image';
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
 * What the element is called: an explicit `data-feedback-name` (the words a
 * writer uses for it, "Profilbild"), aria-label, aria-labelledby, alt, a
 * field's label or placeholder, else its visible text. Never a field's typed value.
 */
export function nameOf(el: Element): string {
  const own = squash(el.getAttribute('data-feedback-name'));
  if (own) return own;
  const label = labelOf(el);
  if (label) return label;
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
 * "Klassische Ansicht: Loadout Bewaffnung › Button „Laser-Repeater S3“" or
 * "Kopfzeile › Navigation › Button „Profilbild (Konto-Menü)“".
 * Area: the regions around the element (outermost and innermost when there are
 * more). Inside the routed page the Codex view stands in front, and the route
 * path when no marked section names the spot; the shell (header, bar, menus)
 * gets neither — those name the page, not the header (feedback #342).
 */
export function captureLine(
  regions: readonly CaptureRegion[],
  page: { view: FeedbackAreaView | null; path: string } | null,
  element: { role: CaptureRole; name: string },
  t: Translate,
): string {
  const shown = regions.length > 2 ? [regions[0], regions[regions.length - 1]] : regions;
  const parts = shown.map((r) => regionLabel(r, t));
  if (page?.path && (!shown.length || shown[0].kind === 'landmark')) parts.unshift(page.path);
  const where = parts.join(' › ');
  const base = page?.view ? `${t(`codex.holo.toggle.${page.view}Hint`)}: ${where}` : where;
  const role = t(`feedbackCapture.role.${element.role}`);
  const what = element.name ? t('feedbackCapture.element', { role, name: element.name }) : role;
  return base ? `${base} › ${what}` : what;
}

function regionLabel(region: CaptureRegion, t: Translate): string {
  if (region.kind === 'spot') return sectionLabel(region.label, t);
  const label = t(region.key);
  return region.name ? t('feedbackSpot.titled', { label, text: region.name }) : label;
}

function sectionLabel(label: FeedbackSpotLabel, t: Translate): string {
  let section = t(label.key);
  if (label.subKey) section = `${section} ${t(label.subKey)}`;
  if (label.text) section = t('feedbackSpot.titled', { label: section, text: label.text });
  return section;
}
