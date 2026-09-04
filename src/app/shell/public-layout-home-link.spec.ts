import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { FooterComponent } from './footer.component';
import { PublicLayoutComponent } from './public-layout.component';

// The footer pulls in the release-notes service; the escape hatch under test
// has nothing to do with it.
@Component({ selector: 'sc-footer', standalone: true, template: '' })
class FooterStub {}

/**
 * Feedback fbfd1ed5: the footer-linked pages (/about, /legal/privacy,
 * /legal/imprint) render in this bare layout, which had no navigation at all —
 * on mobile the browser back button was the only way home. The way out has to
 * be a REAL anchor so a modified click still opens a new tab.
 */
describe('PublicLayoutComponent home link', () => {
  function setup() {
    TestBed.configureTestingModule({
      imports: [PublicLayoutComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    });
    TestBed.overrideComponent(PublicLayoutComponent, {
      remove: { imports: [FooterComponent] },
      add: { imports: [FooterStub] },
    });
    const fixture = TestBed.createComponent(PublicLayoutComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a real anchor back to the home route', () => {
    const fixture = setup();
    const home = fixture.nativeElement.querySelector('.public-topbar a.home') as HTMLAnchorElement | null;

    expect(home).withContext('home control must be an <a>, not a div/button').toBeTruthy();
    expect(home!.getAttribute('href')).toBe('/');
  });

  it('places the link above the routed content, not below it', () => {
    const fixture = setup();
    const shell = fixture.nativeElement.querySelector('.public-shell') as HTMLElement;
    const home = shell.querySelector('a.home')!;
    const content = shell.querySelector('.content')!;

    expect(home.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING)
      .withContext('the way out must be reachable without scrolling')
      .toBeTruthy();
  });

  it('gives the link a localized label', () => {
    const fixture = setup();
    const label = fixture.nativeElement.querySelector('a.home .label') as HTMLElement;

    expect(label.textContent!.trim()).toBe('nav.backToHome');
  });
});
