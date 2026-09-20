import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarSharedLoadoutComponent } from './hangar-shared-loadout.component';
import { HangarService } from './hangar.service';
import { AuthService } from '../auth/auth.service';
import { PeekedSharedLoadout } from './hangar.types';

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

  function setup(token: string, isAuthenticated: boolean): void {
    peekSharedLoadout = jasmine.createSpy('peekSharedLoadout');
    adoptSharedLoadout = jasmine.createSpy('adoptSharedLoadout');
    TestBed.configureTestingModule({
      imports: [HangarSharedLoadoutComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: HangarService, useValue: { peekSharedLoadout, adoptSharedLoadout } },
        { provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
        { provide: ActivatedRoute, useValue: makeRoute(token) },
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

  it('renders the unavailable state for an empty token without calling the service', async () => {
    setup('', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(peekSharedLoadout).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.state__title')).toBeTruthy();
  });
});
