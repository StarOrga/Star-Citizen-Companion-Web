import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexLandingCodexPaneComponent } from './codex-landing-codex-pane.component';
import { FIGURE_AREA, figureRect, viewBoxAspect } from './codex-landing-holotable.component';
import { BODY_ANCHORS } from './codex-landing-values';
import { LANDING_CATEGORIES, LandingCategory, LandingItem } from './codex-landing-data.types';
import de from '../../../../public/i18n/de.json';
import en from '../../../../public/i18n/en.json';

function item(category: LandingCategory): LandingItem {
  return {
    category,
    kind: 'weapon',
    className: 'X_' + category,
    name: category,
    eyebrow: { manufacturer: null, descriptor: null },
    detailRoute: ['/codex', 'weapon', 'X_' + category],
    imageUrl: null,
    previewUrl: null,
    overview: [],
    topValues: [],
  };
}

describe('Codex landing: category bar fit (B2.5) and figure fit (B2.6, B2.8)', () => {
  let fixture: ComponentFixture<CodexLandingCodexPaneComponent>;

  async function mount(lang: 'de' | 'en', width: number, active: LandingCategory): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [CodexLandingCodexPaneComponent], providers: [provideRouter([]), provideTranslateService()] });
    const tr = TestBed.inject(TranslateService);
    tr.setTranslation('de', de as never);
    tr.setTranslation('en', en as never);
    tr.use(lang);
    fixture = TestBed.createComponent(CodexLandingCodexPaneComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.cssText = `display:block;width:${width}px;position:absolute;left:0;top:0`;
    document.body.appendChild(host);
    fixture.componentRef.setInput('items', LANDING_CATEGORIES.map(item));
    fixture.componentRef.setInput('active', active);
    fixture.componentRef.setInput('current', item(active));
    fixture.detectChanges();
    await fixture.whenStable();
    await document.fonts?.ready;
    return host;
  }

  afterEach(() => fixture?.nativeElement.remove());

  // Pane widths: tablet 186 (--cx-pane at 721-1099px), desktop 250-gutter-22 up to 350-gutter-22, phone content width 328.
  for (const lang of ['de', 'en'] as const) {
    for (const width of [186, 228, 328]) {
      it(`${lang} at ${width}px: every tab inside the bar, the active name not truncated, for every category`, async () => {
        for (const cat of LANDING_CATEGORIES) {
          const host = await mount(lang, width, cat);
          const bar = host.querySelector<HTMLElement>('.tabs')!.getBoundingClientRect();
          const tabs = Array.from(host.querySelectorAll<HTMLElement>('.tabs .tab'));
          expect(tabs.length).toBe(5);
          for (const t of tabs) {
            const r = t.getBoundingClientRect();
            expect(r.left).withContext(`${cat} tab left`).toBeGreaterThanOrEqual(bar.left - 0.5);
            expect(r.right).withContext(`${cat} tab right`).toBeLessThanOrEqual(bar.right + 0.5);
          }
          const nm = host.querySelector<HTMLElement>('.tab.on .nm')!;
          expect(nm.scrollWidth).withContext(`${lang} ${cat} name`).toBeLessThanOrEqual(nm.clientWidth + 1);
          const body = host.querySelector<HTMLElement>('.body')!;
          expect(body.scrollWidth).withContext('no sideways scroll').toBeLessThanOrEqual(body.clientWidth + 1);
          fixture.nativeElement.remove();
        }
      });
    }
  }

  it('the figure fits inside the figure area for any aspect, never exceeds the hologram box', () => {
    for (const aspect of [0.2, 0.5, 1, 2.5, 6]) {
      for (const air of [{ w: 900, h: 520 }, { w: 330, h: 460 }, { w: 1400, h: 700 }]) {
        const r = figureRect(aspect, air);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(100);
        expect(r.y + r.h).toBeLessThanOrEqual(100);
        expect(r.w).toBeLessThanOrEqual(FIGURE_AREA.width + 0.01);
        expect(r.h).toBeLessThanOrEqual(FIGURE_AREA.height + 0.01);
        // Real aspect of the rect in pixels equals the figure's own.
        expect((r.w * air.w * 0.4) / (r.h * air.h * 0.72)).toBeCloseTo(aspect, 1);
      }
    }
  });

  it('body anchors, mapped onto the figure rect, land inside the figure rect', () => {
    const r = figureRect(2.2, { w: 900, h: 520 });
    for (const a of BODY_ANCHORS) {
      const x = r.x + (a.x / 100) * r.w;
      const y = r.y + (a.y / 100) * r.h;
      expect(x).toBeGreaterThan(r.x);
      expect(x).toBeLessThan(r.x + r.w);
      expect(y).toBeGreaterThan(r.y);
      expect(y).toBeLessThan(r.y + r.h);
    }
  });

  it('reads the viewBox aspect, 1 when unreadable', () => {
    expect(viewBoxAspect('0 0 200 100')).toBe(2);
    expect(viewBoxAspect('nonsense')).toBe(1);
    expect(viewBoxAspect(null)).toBe(1);
  });
});
