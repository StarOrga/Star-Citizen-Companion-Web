import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ResizeDriver, installResizeDriver } from '../testing/frames';
import { ScScrollHintDirective } from './scroll-hint.directive';

@Component({
  standalone: true,
  imports: [ScScrollHintDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div scScrollHint style="width:100px;overflow-x:auto;white-space:nowrap">
      <span style="display:inline-block" [style.width.px]="contentWidth()">x</span>
    </div>
  `,
})
class HostComponent {
  readonly contentWidth = signal(400);
}

describe('ScScrollHintDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let strip: HTMLElement;
  let resize: ResizeDriver;

  beforeEach(async () => {
    // Spec-driven ResizeObserver: a hidden Karma page delivers no real one.
    resize = installResizeDriver();
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    strip = fixture.nativeElement.querySelector('[scScrollHint]');
  });

  const scrollTo = (x: number) => {
    strip.scrollLeft = x;
    strip.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();
  };

  it('marks only the end while the strip sits at its start', () => {
    expect(strip.classList).toContain('sc-scroll-hint');
    expect(strip.hasAttribute('data-more-end')).toBeTrue();
    expect(strip.hasAttribute('data-more-start')).toBeFalse();
  });

  it('marks only the start once scrolled to the end', () => {
    scrollTo(300);
    expect(strip.hasAttribute('data-more-start')).toBeTrue();
    expect(strip.hasAttribute('data-more-end')).toBeFalse();
  });

  it('marks both edges in the middle of the range', () => {
    scrollTo(120);
    expect(strip.hasAttribute('data-more-start')).toBeTrue();
    expect(strip.hasAttribute('data-more-end')).toBeTrue();
  });

  it('watches the strip and its content for size changes', () => {
    expect(resize.observed()).toContain(strip);
    expect(resize.observed()).toContain(strip.firstElementChild as Element);
  });

  it('marks nothing once the content fits', () => {
    fixture.componentInstance.contentWidth.set(50);
    fixture.detectChanges();
    resize.notify();
    fixture.detectChanges();
    expect(strip.hasAttribute('data-more-start')).toBeFalse();
    expect(strip.hasAttribute('data-more-end')).toBeFalse();
  });

  it('fades the overflowing edge through the global styles', () => {
    const cs = getComputedStyle(strip) as CSSStyleDeclaration & { webkitMaskImage?: string };
    const mask = cs.maskImage || cs.webkitMaskImage || '';
    expect(mask).toContain('linear-gradient');
  });
});
