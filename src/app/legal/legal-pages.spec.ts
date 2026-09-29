import { Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AboutComponent } from './about.component';
import { ImprintComponent } from './imprint.component';
import { PrivacyComponent } from './privacy.component';

describe('legal pages', () => {
  const pages: [string, Type<unknown>, string][] = [
    ['AboutComponent', AboutComponent, 'legal.about.title'],
    ['ImprintComponent', ImprintComponent, 'legal.imprint.title'],
    ['PrivacyComponent', PrivacyComponent, 'legal.privacy.title'],
  ];

  for (const [name, cmp, titleKey] of pages) {
    describe(name, () => {
      function render() {
        TestBed.configureTestingModule({
          imports: [cmp],
          providers: [provideTranslateService(), provideRouter([])],
        });
        const fixture = TestBed.createComponent(cmp);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
      }

      it('renders one h1 with the title key', () => {
        const h1 = render().querySelectorAll('h1');
        expect(h1.length).toBe(1);
        expect(h1[0].textContent).toContain(titleKey);
      });

      it('opens every external link safely', () => {
        const external = Array.from(render().querySelectorAll('a[href^="http"]')) as HTMLAnchorElement[];
        expect(external.length).toBeGreaterThan(0);
        for (const a of external) {
          expect(a.target).withContext(a.href).toBe('_blank');
          expect(a.rel).withContext(a.href).toBe('noopener noreferrer');
        }
      });
    });
  }
});
