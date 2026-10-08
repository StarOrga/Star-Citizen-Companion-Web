import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarSharedLoadoutComponent } from './hangar-shared-loadout.component';
import { HangarService } from './hangar.service';
import { AuthService } from '../auth/auth.service';
import { PeekedSharedLoadout } from './hangar.types';
import { SharedLoadoutAdopter } from './shared-loadout-adopter.service';

const PEEK: PeekedSharedLoadout = {
  shipClassName: 'AEGS_Gladius',
  loadout: [{ slot: 'WeaponPort1', className: 'KLWE_LaserRepeater_S3' } as never],
  name: 'Standard',
  role: 'multipurpose',
  channel: 'LIVE',
  patchVersion: '4.10',
  ownerName: 'Kestrel',
};

function makeRoute(token: string): Partial<ActivatedRoute> {
  return {
    snapshot: { paramMap: { get: () => token } } as unknown as ActivatedRoute['snapshot'],
  };
}

describe('HangarSharedLoadoutComponent', () => {
  let fixture: ComponentFixture<HangarSharedLoadoutComponent>;
  let peekSharedLoadout: jasmine.Spy;
  let adoptSharedLoadout: jasmine.Spy;
  let adoptAndOpen: jasmine.Spy;

  function setup(token: string, isAuthenticated: boolean): void {
    peekSharedLoadout = jasmine.createSpy('peekSharedLoadout');
    adoptSharedLoadout = jasmine.createSpy('adoptSharedLoadout');
    adoptAndOpen = jasmine.createSpy('adoptAndOpen').and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [HangarSharedLoadoutComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: HangarService, useValue: { peekSharedLoadout, adoptSharedLoadout } },
        { provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
        { provide: ActivatedRoute, useValue: makeRoute(token) },
        { provide: SharedLoadoutAdopter, useValue: { adoptAndOpen } },
      ],
    });
    fixture = TestBed.createComponent(HangarSharedLoadoutComponent);
  }

  it('shows the peek card, no adopt button, and a login CTA for an anonymous visitor', async () => {
    setup('tok123', false);
    peekSharedLoadout.and.returnValue(Promise.resolve(PEEK));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.loadout-name')?.textContent).toContain('Standard');
    expect(fixture.nativeElement.querySelector('button.adopt')).toBeNull();
    expect(fixture.nativeElement.querySelector('a.adopt')).toBeTruthy();
  });

  it('shows an adopt button for a signed-in visitor', async () => {
    setup('tok123', true);
    peekSharedLoadout.and.returnValue(Promise.resolve(PEEK));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button.adopt')).toBeTruthy();
  });

  it('renders the unavailable state for a revoked/expired/unknown token (peek returns null)', async () => {
    setup('deadtoken', false);
    peekSharedLoadout.and.returnValue(Promise.resolve(null));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.state__title')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.loadout-name')).toBeNull();
  });

  it('links the loadout to the Holotable as a real anchor — signed out too (#646)', async () => {
    setup('tok123', false);
    peekSharedLoadout.and.returnValue(Promise.resolve(PEEK));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a.holo') as HTMLAnchorElement;
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius?view=holo&shared=tok123');
    // The login detour comes back to this page.
    const login = fixture.nativeElement.querySelector('a.adopt') as HTMLAnchorElement;
    expect(login.getAttribute('href')).toBe('/login?redirect=%2Fhangar%2Fshared%2Ftok123');
  });

  it('adopt hands over to the adopter (adopt → reload hangar → open ?config=)', async () => {
    setup('tok123', true);
    peekSharedLoadout.and.returnValue(Promise.resolve(PEEK));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button.adopt') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(adoptAndOpen).toHaveBeenCalledWith('tok123', 'AEGS_Gladius');
    adoptAndOpen.and.resolveTo(false);
    (fixture.nativeElement.querySelector('button.adopt') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.err')).toBeTruthy();
  });

  it('a failed read is an error state with retry, not "unavailable"', async () => {
    spyOn(console, 'warn');
    setup('tok123', false);
    peekSharedLoadout.and.returnValue(Promise.reject({ message: 'Failed to fetch' }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"] .state__title')?.textContent).toContain('hangar.shared.loadError');
    peekSharedLoadout.and.returnValue(Promise.resolve(PEEK));
    (el.querySelector('button.retry') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.loadout-name')?.textContent).toContain('Standard');
  });

  it('renders the unavailable state for an empty token without calling the service', async () => {
    setup('', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(peekSharedLoadout).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.state__title')).toBeTruthy();
  });
});
