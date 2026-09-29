import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ExtensionBridgeService } from '../hangar/extension-bridge.service';
import { ExtensionPromoComponent } from './extension-promo.component';

const DISMISS_KEY = 'sc.extensionPromo.dismissed';

describe('ExtensionPromoComponent', () => {
  let waitForExtension: jasmine.Spy;

  async function mount(installed: boolean) {
    waitForExtension = jasmine.createSpy('waitForExtension').and.resolveTo(installed);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: ExtensionBridgeService, useValue: { waitForExtension } },
      ],
    });
    const fixture = TestBed.createComponent(ExtensionPromoComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => localStorage.removeItem(DISMISS_KEY));
  afterEach(() => localStorage.removeItem(DISMISS_KEY));

  it('pitches the extension with a real anchor to the install page when it is missing', async () => {
    const { el } = await mount(false);
    const cta = el.querySelector('a.cta') as HTMLAnchorElement | null;
    expect(cta).not.toBeNull();
    expect(cta!.getAttribute('href')).toBe('/tools/extension');
  });

  it('stays hidden when the extension is already installed', async () => {
    const { el } = await mount(true);
    expect(el.querySelector('.promo')).toBeNull();
  });

  it('stays hidden (and skips the probe) once dismissed', async () => {
    localStorage.setItem(DISMISS_KEY, '1');
    const { el } = await mount(false);
    expect(el.querySelector('.promo')).toBeNull();
    expect(waitForExtension).not.toHaveBeenCalled();
  });

  it('dismiss hides the promo and persists the choice', async () => {
    const { fixture, el } = await mount(false);
    (el.querySelector('button.close') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.promo')).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).toBe('1');
  });
});
