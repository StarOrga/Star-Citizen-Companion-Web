import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HqEventNamesComponent, eventNamesText } from './hq-event-names.component';

@Component({
  standalone: true,
  imports: [HqEventNamesComponent],
  template: `<div [style.width.px]="w()"><sc-hq-event-names [names]="names()" /></div>`,
})
class HostComponent {
  readonly w = signal(600);
  readonly names = signal<string[]>(['Day of the Vara 2956', 'Invictus Launch Week', 'Citizencon Warm-up Broadcast', 'Pirate Week']);
}

describe('HqEventNamesComponent', () => {
  it('builds full names then +N', () => {
    expect(eventNamesText(['A', 'B', 'C'], 3)).toBe('A, B, C');
    expect(eventNamesText(['A', 'B', 'C'], 2)).toBe('A, B +1');
    expect(eventNamesText(['A', 'B', 'C'], 0)).toBe('+3');
  });

  async function mount() {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement.querySelector('sc-hq-event-names') as HTMLElement;
    return { f, el };
  }

  it('is one line at every width: never overflows, never cuts a name, shows +N for the rest', async () => {
    const { f, el } = await mount();
    for (const w of [600, 320, 200, 120]) {
      f.componentInstance.w.set(w);
      f.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const text = el.textContent ?? '';
      expect(el.scrollWidth).withContext(`width ${w}`).toBeLessThanOrEqual(el.clientWidth);
      expect(text).not.toContain('…');
      const names = f.componentInstance.names();
      const shown = text.replace(/ ?\+\d+$/, '').split(', ').filter(Boolean);
      for (const n of shown) expect(names).toContain(n);
      const rest = names.length - shown.length;
      if (rest > 0) expect(text.endsWith(`+${rest}`)).toBeTrue();
    }
  });
});
