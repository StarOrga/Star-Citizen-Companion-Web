import { Component, ChangeDetectionStrategy } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { FooterComponent } from './footer.component';
import { PublicLayoutComponent } from './public-layout.component';
import { skipToMain } from './skip-link';

@Component({ selector: 'sc-footer', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class FooterStub {}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * AUD-154: every page starts with a "Skip to content" link as its first Tab
 * stop. It moves focus to <main id="sc-main"> without changing the URL.
 */
describe('PublicLayoutComponent skip link', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [PublicLayoutComponent],
      providers: [provideTranslateService(), provideRouter([])],
    });
    TestBed.overrideComponent(PublicLayoutComponent, {
      remove: { imports: [FooterComponent] },
      add: { imports: [FooterStub] },
    });
    const fixture = TestBed.createComponent(PublicLayoutComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('is the first focusable element of the layout', () => {
    const fixture = setup();
    const first = (fixture.nativeElement as HTMLElement).querySelector(FOCUSABLE) as HTMLElement | null;

    expect(first).toBeTruthy();
    expect(first!.matches('a.sc-skip-link[href="#sc-main"]')).toBeTrue();
  });

  it('moves focus to the main landmark on a plain click', () => {
    const fixture = setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.isConnected).withContext('TestBed attaches the fixture to the document').toBeTrue();
    const link = root.querySelector('a.sc-skip-link') as HTMLAnchorElement;
    const ev = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    link.dispatchEvent(ev);

    expect(ev.defaultPrevented).withContext('the URL must not gain #sc-main').toBeTrue();
    expect(document.activeElement?.id).toBe('sc-main');
  });

  it('lets a modified click fall through untouched', () => {
    const ev = new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true });
    skipToMain(ev);

    expect(ev.defaultPrevented).toBeFalse();
  });
});
