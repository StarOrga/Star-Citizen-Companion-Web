import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/**
 * Publishes the host's rendered height as a CSS custom property, so a style
 * rule can do layout maths CSS alone cannot (a sticky column that parks with
 * its BOTTOM at the viewport edge needs to know how tall it is).
 *
 *   <div scHeightVar="--_h">                 → set on the host itself
 *   <x scHeightVar="--_kpi-h" scHeightVarOn="parent"> → set on its parent
 *
 * Kept up to date by a ResizeObserver; a browser without one simply never
 * sets the variable, so every rule reading it needs a fallback.
 */
@Directive({ selector: '[scHeightVar]', standalone: true })
export class HeightVarDirective {
  readonly scHeightVar = input.required<string>();
  readonly scHeightVarOn = input<'self' | 'parent'>('self');

  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const el = this.host.nativeElement as HTMLElement;
      let target: HTMLElement | null = null;
      const write = () => {
        target = this.scHeightVarOn() === 'parent' ? el.parentElement : el;
        target?.style.setProperty(this.scHeightVar(), `${Math.round(el.getBoundingClientRect().height)}px`);
      };
      const ro = new ResizeObserver(write);
      ro.observe(el);
      write();
      destroyRef.onDestroy(() => {
        ro.disconnect();
        target?.style.removeProperty(this.scHeightVar());
      });
    });
  }
}
