import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BriefingMoonComponent, MOON_SLOT_S, moonSchedule } from './briefing-moon.component';

const secs = (t: string) => parseFloat(t);

describe('moonSchedule', () => {
  it('gives three moons consecutive 11 s slots in a 41.25 s loop', () => {
    const t = [0, 1, 2].map((i) => moonSchedule(i, 3, 4.2));
    expect(t.map((x) => x.start)).toEqual(['4.20s', '15.20s', '26.20s']);
    expect(t.every((x) => x.cycle === '41.25s')).toBeTrue();
  });

  it('never lets two slots overlap and keeps the calm at 20 % or more', () => {
    for (const count of [1, 2, 3, 4, 6]) {
      const t = Array.from({ length: count }, (_, i) => moonSchedule(i, count));
      const cycle = secs(t[0].cycle);
      for (let i = 1; i < count; i++) expect(secs(t[i].start) - secs(t[i - 1].start)).toBeGreaterThanOrEqual(MOON_SLOT_S);
      const calm = cycle - count * MOON_SLOT_S;
      expect(calm / cycle).toBeGreaterThanOrEqual(0.2 - 1e-9);
    }
  });

  it('clamps a bad index and intro', () => {
    expect(moonSchedule(-3, 3, -1).start).toBe('0.00s');
    expect(moonSchedule(9, 3).start).toBe('22.00s');
  });
});

describe('BriefingMoonComponent', () => {
  function render(fresh: string | null) {
    TestBed.configureTestingModule({ imports: [BriefingMoonComponent], providers: [provideRouter([])] });
    const f = TestBed.createComponent(BriefingMoonComponent);
    f.componentRef.setInput('door', 'gallery');
    f.componentRef.setInput('link', '/verse/gallery');
    f.componentRef.setInput('topic', 'Galerie');
    f.componentRef.setInput('hook', 'Hook');
    f.componentRef.setInput('neu', 'NEU');
    f.componentRef.setInput('fresh', fresh);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('is one anchor named by its aria-label, without a tooltip', () => {
    const a = render('Neues Bild').querySelector('a.moon')!;
    expect(a.getAttribute('href')).toBe('/verse/gallery');
    expect(a.getAttribute('aria-label')).toBe('Galerie: NEU · Neues Bild');
    expect(a.hasAttribute('title')).toBeFalse();
    expect(a.hasAttribute('scTooltip')).toBeFalse();
  });

  it('draws Hurston for the gallery and types the item char by char', () => {
    const el = render('Abc');
    expect(el.querySelector('.art.hurston')).not.toBeNull();
    expect(el.querySelectorAll('.chr').length).toBe(3);
  });

  it('marks a quiet moon and renders no NEU line', () => {
    const el = render(null);
    expect(el.querySelector('.line.quiet')).not.toBeNull();
    expect(el.querySelector('.new')).toBeNull();
  });
});
