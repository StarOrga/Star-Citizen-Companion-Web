import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexLandingValuesPaneComponent } from './codex-landing-values-pane.component';
import { LandingItem, LandingValue } from './codex-landing-data.types';
import de from '../../../../public/i18n/de.json';

const value = (key: string, n: number): LandingValue => ({ key, value: n, unit: null, classAvg: n / 2, classMax: n * 2, higherIsBetter: true });

function item(count: number): LandingItem {
  return {
    category: 'component', kind: 'component', className: 'X', name: 'Testgeraet',
    eyebrow: { manufacturer: null, descriptor: null }, detailRoute: ['/codex', 'component', 'X'],
    imageUrl: null, previewUrl: null, overview: [],
    topValues: Array.from({ length: count }, (_, i) => value(`k${i}`, 10 + i)),
  } as LandingItem;
}

describe('Codex landing data sheet: always the column height, never scrolls (#8)', () => {
  for (const h of [180, 260, 420, 700]) {
    it(`at ${h}px: no inner overflow, the page button stays, rows are cut from the end`, async () => {
      TestBed.configureTestingModule({ imports: [CodexLandingValuesPaneComponent], providers: [provideRouter([]), provideTranslateService()] });
      const tr = TestBed.inject(TranslateService);
      tr.setTranslation('de', de as never);
      tr.use('de');
      const fixture = TestBed.createComponent(CodexLandingValuesPaneComponent);
      const host = fixture.nativeElement as HTMLElement;
      host.style.cssText = `display:flex;flex-direction:column;position:absolute;left:0;top:0;width:260px;height:${h}px;`;
      document.body.appendChild(host);
      fixture.componentRef.setInput('item', item(9));
      fixture.componentRef.setInput('still', true);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 120));
      fixture.componentInstance.fitRows();
      const body = host.querySelector<HTMLElement>('.body')!;
      expect(getComputedStyle(body).overflowY).not.toBe('auto');
      const go = host.querySelector<HTMLElement>('.go')!;
      expect(go.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom + 1);
      const cut = Array.from(host.querySelectorAll<HTMLElement>('.row')).map((r) => r.classList.contains('cut'));
      const firstCut = cut.indexOf(true);
      if (firstCut !== -1) expect(cut.slice(firstCut).every(Boolean)).withContext('the cut rows are the last ones').toBeTrue();
      if (h === 700) expect(cut.some(Boolean)).toBeFalse();
      if (h === 180) expect(cut.some(Boolean)).toBeTrue();
      fixture.destroy();
      host.remove();
    });
  }
});
