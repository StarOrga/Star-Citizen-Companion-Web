import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';

/** Attribute the directive sets on its host while the host is completely out of view. */
export const OFFSCREEN_ATTR = 'data-sc-offscreen';

/**
 * Marks its host with `data-sc-offscreen` while no part of it is in the
 * viewport, so the host's own styles can stand their endless decorative loops
 * still there (`:host([data-sc-offscreen]) … { animation-play-state: paused }`).
 *
 * Which animations pause is the component's decision, not this directive's:
 * one-shot entrances and anything an `[animate.leave]` waits for must keep
 * running, or a leaving element would never be removed. The attribute is set
 * directly on the element (no change detection), from one shared observer.
 */
@Directive({ selector: '[scPauseOffscreen]', standalone: true })
export class PauseOffscreenDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  ngOnInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    this.zone.runOutsideAngular(() => observer().observe(this.host));
  }

  ngOnDestroy(): void {
    shared?.unobserve(this.host);
  }
}

let shared: IntersectionObserver | null = null;

function observer(): IntersectionObserver {
  return (shared ??= new IntersectionObserver((entries) => {
    for (const e of entries) e.target.toggleAttribute(OFFSCREEN_ATTR, !e.isIntersecting);
  }));
}
