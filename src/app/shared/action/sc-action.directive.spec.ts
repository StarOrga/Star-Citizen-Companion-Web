import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScActionDirective } from './sc-action.directive';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';

@Component({
  imports: [ScActionDirective, ScTooltipDirective],
  template: `
    <button class="p" scAction tier="primary" type="button" [busy]="busy()" (click)="clicks = clicks + 1">Go</button>
    <a class="s" scAction tier="secondary" tone="hot" href="/x">Link</a>
    <button class="t" scAction tier="tertiary" tone="danger" type="button" [scTooltip]="'Del'" scTooltipTier="label" aria-label="Del">x</button>
  `,
})
class HostCmp {
  busy = signal(false);
  clicks = 0;
}

describe('ScActionDirective', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostCmp>>;
  const q = (s: string) => fixture.nativeElement.querySelector(s) as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostCmp);
    fixture.detectChanges();
  });

  it('adds tier and tone classes on native elements', () => {
    expect(q('.p').classList).toContain('sc-action--primary');
    expect(q('a.s').classList).toContain('sc-action--secondary');
    expect(q('a.s').classList).toContain('sc-action--hot');
    expect(q('a.s').getAttribute('href')).toBe('/x');
    expect(q('.t').classList).toContain('sc-action--tertiary');
    expect(q('.t').classList).toContain('sc-action--danger');
  });

  it('busy adds ring and aria-busy and swallows clicks', () => {
    q('.p').click();
    expect(fixture.componentInstance.clicks).toBe(1);
    fixture.componentInstance.busy.set(true);
    fixture.detectChanges();
    expect(q('.p .sc-action-ring')).toBeTruthy();
    expect(q('.p').getAttribute('aria-busy')).toBe('true');
    q('.p').click();
    expect(fixture.componentInstance.clicks).toBe(1);
    fixture.componentInstance.busy.set(false);
    fixture.detectChanges();
    expect(q('.p .sc-action-ring')).toBeNull();
    expect(q('.p').hasAttribute('aria-busy')).toBe(false);
  });

  it('tertiary keeps its accessible name', () => {
    expect(q('.t').getAttribute('aria-label')).toBe('Del');
  });
});
