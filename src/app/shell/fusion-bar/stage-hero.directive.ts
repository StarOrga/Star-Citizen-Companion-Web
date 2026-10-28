import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';
import { BetaService } from '../../core/beta.service';

/** Fired on window when a hero moved its slot: the bar re-places its staged field. */
export const STAGE_SLOT_MOVED = 'sc-stage-slot-moved';
/** Share of the viewport height where the staged field's top stands (concept r8 `dockmove`: top 41 %). */
export const STAGE_FIELD_TOP = 0.41;
/** The hero never climbs more than this over its natural place (short viewports). */
const MAX_LIFT_PX = 200;
/** Settling passes per change: a hero centred by its parent moves by a fraction of its margin. */
const MAX_PASSES = 6;

/** Document y the stage slot's top aims at, the same on every main page. */
export function stageSlotTarget(viewportHeight: number): number {
  return Math.round(viewportHeight * STAGE_FIELD_TOP);
}

/**
 * The hero block of a main page (eyebrow · one h1 · stage slot), beta shell only
 * (concept r1 "same spot", r8 stage). Verse, Codex, HQ and the admin hub differ
 * above their hero, so the block shifts itself (margin-top, `--_hero-shift`) until
 * its `[scStageSearch]` slot stands at {@link stageSlotTarget}: the staged field sits
 * at the same spot on every main page, and a main → main switch or Back/Forward
 * never moves it. The block fades with its title when the field docks (styles.scss).
 */
@Directive({
  selector: '[scStageHero]',
  standalone: true,
  host: { '[attr.data-stage-hero]': "on() ? '' : null" },
})
export class StageHeroDirective {
  readonly on = inject(BetaService).isEnabled('shell');

  constructor() {
    const el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    let frame = 0;
    // A hero its parent centres moves by a fraction of its margin: settle in a few passes.
    const align = () => {
      frame = 0;
      if (!this.on()) {
        el.style.removeProperty('--_hero-shift');
        return;
      }
      const slot = el.querySelector<HTMLElement>('[data-stage-slot]');
      if (!slot) return;
      let moved = false;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const cur = parseFloat(el.style.getPropertyValue('--_hero-shift')) || 0;
        const slotTop = slot.getBoundingClientRect().top + window.scrollY;
        const next = Math.max(-MAX_LIFT_PX, Math.round(cur + stageSlotTarget(window.innerHeight) - slotTop));
        if (Math.abs(next - cur) < 1) break;
        el.style.setProperty('--_hero-shift', `${next}px`);
        moved = true;
      }
      if (moved) window.dispatchEvent(new Event(STAGE_SLOT_MOVED));
    };
    // Later changes are measured one frame later: a write inside a ResizeObserver callback would loop it.
    function schedule(): void {
      if (!frame) frame = requestAnimationFrame(align);
    }
    afterNextRender(() => {
      if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
      // The first alignment before the first paint: the page never shows its slot elsewhere,
      // so the field (which stays put on a main → main switch) never sees it move.
      align();
      // The route entrance (a short rise) and late data around the hero settle within ~3 s;
      // a page growing above the hero moves it without resizing it, so the body is watched too.
      const lates = [650, 1500, 3000].map((ms) => setTimeout(() => schedule(), ms));
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule());
      ro?.observe(el);
      ro?.observe(document.body);
      const onResize = () => schedule();
      window.addEventListener('resize', onResize, { passive: true });
      destroyRef.onDestroy(() => {
        lates.forEach(clearTimeout);
        ro?.disconnect();
        window.removeEventListener('resize', onResize);
        if (frame) cancelAnimationFrame(frame);
      });
    });
  }
}
