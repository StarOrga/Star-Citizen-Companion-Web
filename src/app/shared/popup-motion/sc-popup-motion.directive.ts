import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  EnvironmentInjector,
  NgZone,
  OnDestroy,
  OnInit,
  ViewEncapsulation,
  afterNextRender,
  createComponent,
  inject,
  input,
  ApplicationRef,
} from '@angular/core';

/** `small` = beam + unfold (menus, notices); `large` = horizon plate; `panel` = the compact horizon rise of an in-page panel. */
export type PopupMotionKind = 'small' | 'large' | 'panel';
/** The corner the popup grows from: its trigger, or the screen corner a notice stands in. */
export type PopupMotionOrigin = 'tl' | 'tr' | 'bl' | 'br';

/** Open durations in ms per kind; must match `--pm-total` in popup-motion.scss. */
export const POPUP_MOTION_TOTAL: Record<PopupMotionKind, number> = { small: 800, large: 1960, panel: 960 };
/** A close plays the open reversed in this share of the time. */
export const POPUP_MOTION_CLOSE_SHARE = 0.6;
/** Plain-fade length when the visitor asked for reduced motion. */
export const POPUP_MOTION_REDUCED_MS = 160;
/** Row stagger: the Codex index pace. */
export const POPUP_MOTION_ROW_STEP_MS = 70;
const MAX_STAGGER = 10;
const MAX_ANIMATED_ROWS = 16;

/** Holds the (global, un-encapsulated) stylesheet; created once, never destroyed so the styles stay. */
@Component({
  selector: 'sc-popup-motion-styles',
  standalone: true,
  template: '',
  styleUrl: './popup-motion.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScPopupMotionStylesComponent {}

/**
 * Apps the shared stylesheet is mounted in. Keyed by the ApplicationRef, not a module flag: a
 * new application (every TestBed reset, a re-bootstrap) gets its own style host and would
 * otherwise never see the popup keyframes again.
 */
const stylesMounted = new WeakSet<ApplicationRef>();

/** Class on <html> while a large popup is open: the shell scene pushes in ~4 % and dims (P2 "Szene stößt vor"). */
export const SCENE_PUSHIN_CLASS = 'sc-scene-pushin';
let pushins = 0;
function scenePush(on: boolean): void {
  if (typeof document === 'undefined') return;
  pushins = Math.max(0, pushins + (on ? 1 : -1));
  document.documentElement.classList.toggle(SCENE_PUSHIN_CLASS, pushins > 0);
}

/** Deterministic star field in viewport units (same sky every time, no Math.random in a template). */
export function popupStarShadow(count = 90): string {
  let seed = 20261109;
  const next = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const stars: string[] = [];
  for (let i = 0; i < count; i++) {
    const warm = next() > 0.9;
    const big = next() > 0.8;
    stars.push(`${(next() * 106 - 3).toFixed(2)}vw ${(next() * 106 - 3).toFixed(2)}vh 0 ${big ? '0.7px' : '0.2px'} ${warm ? '#ffe7c4' : '#dff0ff'}`);
  }
  return stars.join(',');
}

/**
 * `[scPopupMotion]` - the Kamera-Welt popup motion (concept 20261109-1752):
 *
 * - `small`: an impulse ring at the trigger corner, a light beam running to panel width, the
 *   panel unfolding from the beam, a curved horizon-limb glow on its top edge, entries flickering
 *   in like a hologram. No corner brackets.
 * - `large` (A Horizont): the veil fades in, slow stars drift in it, a planet horizon rises at the
 *   bottom, the plate rises behind it with a light-catching top edge, head and filters, table
 *   rows line by line (70 ms apart, the Codex index pace), footnotes last, the horizon sinks.
 * - `panel`: the same idea for an in-page panel - edge light, rise, rows.
 *
 * The host is the popup (small, panel) or the full-screen veil (large; the plate is the first
 * element child, or `scPopupMotionPlate`). Closing: `exit()` (Promise) or `animate.leave="pm-out"`
 * on an `@if` element; both play the open reversed in 60 % of the time. Reduced motion: a plain fade.
 * Focus, Escape and the scrim rules stay with `[scDialog]`; this only paints.
 */
@Directive({
  selector: '[scPopupMotion]',
  standalone: true,
  exportAs: 'scPopupMotion',
  host: { class: 'pm-host' },
})
export class ScPopupMotionDirective implements OnInit, OnDestroy {
  readonly scPopupMotion = input<PopupMotionKind | ''>('small');
  readonly scPopupMotionOrigin = input<PopupMotionOrigin>('tr');
  /** Large: CSS selector of the plate inside the veil; default the first element child. */
  readonly scPopupMotionPlate = input('');
  /** Large/panel: rows that cascade in. */
  readonly scPopupMotionRows = input('tbody tr, .pm-row-src');
  /** Large: footnote elements that appear last. */
  readonly scPopupMotionFoot = input('');
  /** Small: entries that flicker in. */
  readonly scPopupMotionItems = input('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly env = inject(EnvironmentInjector);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private observer: MutationObserver | null = null;
  private leaveObserver: MutationObserver | null = null;
  private leaving = false;
  private exiting: Promise<void> | null = null;
  private pushing = false;

  constructor() {
    const app = this.env.get(ApplicationRef);
    if (!stylesMounted.has(app) && typeof document !== 'undefined') {
      stylesMounted.add(app);
      createComponent(ScPopupMotionStylesComponent, { environmentInjector: this.env });
    }
    afterNextRender(() => this.index());
  }

  get kind(): PopupMotionKind {
    return this.scPopupMotion() || 'small';
  }

  ngOnInit(): void {
    const kind = this.kind;
    const cl = this.host.classList;
    cl.add(`pm-${kind}`, 'pm-in');
    if (kind === 'small') cl.add(`pm-o-${this.scPopupMotionOrigin()}`);
    if (kind === 'large') this.push(true);
    this.buildLayers(kind);
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => this.settle(), POPUP_MOTION_TOTAL[kind] + 80);
      if (typeof MutationObserver !== 'undefined') {
        this.observer = new MutationObserver(() => this.index());
        this.observer.observe(this.host, { childList: true, subtree: true });
        // `animate.leave="pm-out"` switches the class itself (Angular then waits for the
        // animations): the close has to start its animations over just like `exit()` does.
        this.leaveObserver = new MutationObserver(() => {
          if (this.exiting || this.leaving || !this.host.classList.contains('pm-out')) return;
          this.leaving = true;
          this.host.classList.remove('pm-in');
          this.replay();
          this.push(false);
        });
        this.leaveObserver.observe(this.host, { attributes: true, attributeFilter: ['class'] });
      }
    });
  }

  /** Play the close (the open reversed in 60 % of the time); resolves when it is over. */
  exit(): Promise<void> {
    if (this.exiting) return this.exiting;
    this.clearTimer();
    this.observer?.disconnect();
    this.observer = null;
    const cl = this.host.classList;
    cl.remove('pm-in');
    cl.add('pm-out');
    this.replay();
    // The scene pulls back out together with the close.
    this.push(false);
    const reduced = this.reduced();
    const ms = reduced ? POPUP_MOTION_REDUCED_MS : Math.round(POPUP_MOTION_TOTAL[this.kind] * POPUP_MOTION_CLOSE_SHARE) + 30;
    this.exiting = new Promise<void>((resolve) => {
      this.zone.runOutsideAngular(() => setTimeout(() => this.zone.run(resolve), ms));
    });
    return this.exiting;
  }

  /** Re-open while a close is still playing (the host never left the DOM): play the open again. */
  restart(): void {
    if (!this.exiting) return;
    this.exiting = null;
    const cl = this.host.classList;
    cl.remove('pm-out');
    void this.host.offsetWidth;
    cl.add('pm-in');
    this.replay();
    if (this.kind === 'large') this.push(true);
    this.clearTimer();
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => this.settle(), POPUP_MOTION_TOTAL[this.kind] + 80);
    });
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.leaveObserver?.disconnect();
    this.observer?.disconnect();
    this.push(false);
  }

  /**
   * Start every keyframe animation of the popup over after the in/out switch. The close keeps
   * the open's animation names (only direction, duration and delay change), and a running or
   * finished CSS animation does not restart for that: its clock already stood past the new
   * end, so the reversed animation was over in its first frame - the plate went to opacity 0
   * at once and the veil stood empty until removal (QA D10, P1). `getAnimations()` flushes the
   * new timing first. Infinite ones (the star drift) keep running.
   */
  private replay(): void {
    if (typeof this.host.getAnimations !== 'function') return;
    for (const a of this.host.getAnimations({ subtree: true })) {
      if (a.effect?.getTiming().iterations === Infinity) continue;
      a.currentTime = 0;
    }
  }

  private push(on: boolean): void {
    if (this.pushing === on) return;
    this.pushing = on;
    scenePush(on);
  }

  private reduced(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Open animation done: drop the class (the layers keep their resting look), stop observing. */
  private settle(): void {
    this.host.classList.remove('pm-in');
    this.observer?.disconnect();
    this.observer = null;
    this.timer = null;
  }

  private layer(cls: string, parent: HTMLElement = this.host, first = false): HTMLElement {
    const el = document.createElement('span');
    el.className = `pm-layer ${cls}`;
    el.setAttribute('aria-hidden', 'true');
    if (first) parent.prepend(el);
    else parent.append(el);
    return el;
  }

  private buildLayers(kind: PopupMotionKind): void {
    if (this.host.querySelector(':scope > .pm-layer, :scope > * > .pm-edge')) return;
    if (kind === 'small') {
      if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
      this.layer('pm-limb');
      this.layer('pm-beam');
      this.layer('pm-ring');
    } else if (kind === 'large') {
      const stars = this.layer('pm-stars', this.host, true);
      stars.style.setProperty('--pm-star-shadow', popupStarShadow());
      this.layer('pm-horizon', this.host, true);
      const plate = this.plate();
      if (plate) {
        plate.classList.add('pm-plate');
        this.layer('pm-edge', plate);
        for (const child of Array.from(plate.children)) {
          if (!child.classList.contains('pm-layer')) child.classList.add('pm-plate-body');
        }
      }
    } else {
      if (getComputedStyle(this.host).position === 'static') this.host.style.position = 'relative';
      this.layer('pm-edge');
    }
  }

  private plate(): HTMLElement | null {
    const sel = this.scPopupMotionPlate();
    if (sel) return this.host.querySelector<HTMLElement>(sel);
    return Array.from(this.host.children).find((c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('pm-layer') && !c.classList.contains('pick-hint')) ?? null;
  }

  /** Number the cascading elements (--pm-i), capped so a long table does not stretch the open. */
  private index(): void {
    const kind = this.kind;
    if (kind === 'small') {
      const sel = this.scPopupMotionItems();
      if (!sel) return;
      this.host.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
        el.classList.add('pm-item');
        el.style.setProperty('--pm-i', String(Math.min(i, MAX_STAGGER)));
      });
      return;
    }
    const rows = this.host.querySelectorAll<HTMLElement>(this.scPopupMotionRows());
    // Only the rows that can be on screen cascade; a 300-row table must not run 300 filtered animations.
    rows.forEach((el, i) => {
      if (i >= MAX_ANIMATED_ROWS) return;
      if (!el.classList.contains('pm-row')) el.classList.add('pm-row');
      el.style.setProperty('--pm-i', String(Math.min(i, MAX_STAGGER)));
    });
    const foot = this.scPopupMotionFoot();
    if (foot) this.host.querySelectorAll<HTMLElement>(foot).forEach((el) => el.classList.add('pm-foot'));
  }
}
