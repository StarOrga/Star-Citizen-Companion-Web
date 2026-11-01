import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScTristateComponent, clampFraction, tristateOf } from './sc-tristate.component';

@Component({
  standalone: true,
  imports: [ScTristateComponent],
  template: `<sc-tristate [value]="v()" [variant]="variant()" label="Pembroke" (toggled)="last = $event" />`,
})
class HostComponent {
  v = signal(0);
  variant = signal<'ring' | 'checkbox'>('ring');
  last: number | null = null;
}

describe('ScTristateComponent', () => {
  function setup() {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const btn = () => f.nativeElement.querySelector('button') as HTMLButtonElement;
    return { f, btn };
  }

  it('maps fractions to empty / partial / full and clamps garbage', () => {
    expect(tristateOf(0)).toBe('empty');
    expect(tristateOf(0.25)).toBe('partial');
    expect(tristateOf(1)).toBe('full');
    expect(tristateOf(7)).toBe('full');
    expect(tristateOf(NaN)).toBe('empty');
    expect(clampFraction(-1)).toBe(0);
  });

  it('reports aria-checked false / mixed / true for the ring', () => {
    const { f, btn } = setup();
    expect(btn().getAttribute('role')).toBe('checkbox');
    expect(btn().getAttribute('aria-checked')).toBe('false');
    expect(f.nativeElement.querySelector('.arc')).toBeNull();
    f.componentInstance.v.set(0.25);
    f.detectChanges();
    expect(btn().getAttribute('aria-checked')).toBe('mixed');
    expect(f.nativeElement.querySelector('.arc')).not.toBeNull();
    f.componentInstance.v.set(1);
    f.detectChanges();
    expect(btn().getAttribute('aria-checked')).toBe('true');
    expect(f.nativeElement.querySelector('.sheen')).not.toBeNull();
  });

  it('draws the arc proportionally', () => {
    const { f } = setup();
    f.componentInstance.v.set(0.5);
    f.detectChanges();
    const dash = f.nativeElement.querySelector('.arc').getAttribute('stroke-dasharray') as string;
    const [on, off] = dash.split(' ').map(Number);
    expect(on / (on + off)).toBeCloseTo(0.5, 2);
  });

  it('renders the checkbox variant with a dash for mixed and a tick for all', () => {
    const { f } = setup();
    f.componentInstance.variant.set('checkbox');
    f.componentInstance.v.set(0.5);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.box')).not.toBeNull();
    expect(f.nativeElement.querySelector('.mark')?.getAttribute('d')).toBe('M7.5 12h9');
    f.componentInstance.v.set(1);
    f.detectChanges();
    expect(f.nativeElement.querySelector('.mark')?.getAttribute('d')).toContain('l3 3');
  });

  it('a click leads to full, except from full where it leads to empty', () => {
    const { f, btn } = setup();
    btn().click();
    expect(f.componentInstance.last).toBe(1);
    f.componentInstance.v.set(0.25);
    f.detectChanges();
    btn().click();
    expect(f.componentInstance.last).toBe(1);
    f.componentInstance.v.set(1);
    f.detectChanges();
    btn().click();
    expect(f.componentInstance.last).toBe(0);
  });
});
