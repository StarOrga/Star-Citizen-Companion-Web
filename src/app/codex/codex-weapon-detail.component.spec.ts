import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexWeaponDetailComponent, WeaponDetailEntry } from './codex-weapon-detail.component';
import { NOMAD_REPEATERS, resourceStats } from './testing/nomad-power.fixture';

// A probe-like weapon fixture built from NOMAD_REPEATERS' payload shape
// (KLWE_LaserRepeater_S3): 1.0 standard power unit, no segments, no EM/IR
// signature, HP 1500, distortion pool 500000 — matching the live probe dump.
const WEAPON_PAYLOAD = {
  className: NOMAD_REPEATERS.className,
  kind: 'weapon',
  mass: NOMAD_REPEATERS.mass,
  weaponParams: { fireRate: 0 },
  stats: {
    ...resourceStats(NOMAD_REPEATERS),
    SHealthComponentParams: { Health: 1500 },
    SDistortionParams: { Maximum: 500000 },
  },
};

const AMMO_PAYLOAD = {
  impactDamage: { energy: 42 },
  speed: 1200,
  lifetime: 2,
  raw: { projectileParams: { penetrationParams: { basePenetrationDistance: 0.09 } } },
};

function entry(overrides: Partial<WeaponDetailEntry> = {}): WeaponDetailEntry {
  return {
    className: NOMAD_REPEATERS.className,
    name: 'CF-337 Panther Repeater',
    port: 'Waffe 1',
    size: 3,
    grade: 'A',
    manufacturerCode: 'KLA',
    payload: WEAPON_PAYLOAD,
    ammoPayload: AMMO_PAYLOAD,
    ...overrides,
  };
}

describe('CodexWeaponDetailComponent', () => {
  let fixture: ComponentFixture<CodexWeaponDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexWeaponDetailComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexWeaponDetailComponent);
  });

  it('renders nothing when there is no entry', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.wd-panel')).toBeNull();
  });

  it('opens with the weapon name as the dialog title', () => {
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#wd-title').textContent).toContain('Panther Repeater');
  });

  it('renders a present value in the damage-channels card', () => {
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.val-card')) as HTMLElement[];
    const damageCard = cards.find((c) => c.querySelector('h4')?.textContent?.includes('codex.weaponDetail.card.damageChannels'));
    expect(damageCard).toBeTruthy();
    const rows = Array.from(damageCard!.querySelectorAll('.row .v')) as HTMLElement[];
    expect(rows.some((r) => !r.classList.contains('gapv') && r.textContent?.trim() === '42')).toBeTrue();
  });

  it('marks the closing "missing" card gold-dashed and every row a gap', () => {
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.val-card')) as HTMLElement[];
    const missing = cards[cards.length - 1];
    expect(missing.classList.contains('miss')).toBeTrue();
    const spread = Array.from(missing.querySelectorAll('.row')).find((r) =>
      r.querySelector('.k')?.textContent?.includes('codex.weaponDetail.row.spread'),
    );
    expect(spread!.querySelector('.v')!.classList.contains('gapv')).toBeTrue();
  });

  it('names the energy-weapon magazine gap specially instead of a plain dash', () => {
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.val-card')) as HTMLElement[];
    const missing = cards[cards.length - 1];
    const magazine = Array.from(missing.querySelectorAll('.row')).find((r) =>
      r.querySelector('.k')?.textContent?.includes('codex.weaponDetail.row.magazine'),
    );
    expect(magazine!.querySelector('.v')!.textContent).toContain('codex.weaponDetail.value.magazineEnergy');
  });

  it('shows the power/EM/HP/distortion values it reads through swap-table.ts', () => {
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
    const cards = Array.from(fixture.nativeElement.querySelectorAll('.val-card')) as HTMLElement[];
    const durability = cards.find((c) => c.querySelector('h4')?.textContent?.includes('codex.weaponDetail.card.durability'));
    const hpRow = Array.from(durability!.querySelectorAll('.row')).find((r) =>
      r.querySelector('.k')?.textContent?.includes('codex.weaponDetail.row.hp'),
    );
    expect(hpRow!.querySelector('.v')!.classList.contains('gapv')).toBeFalse();
    expect(hpRow!.querySelector('.v')!.textContent?.trim()).toBe('1,500');
  });

  it('closes on Escape', () => {
    fixture.componentRef.setInput('entry', entry());
    fixture.detectChanges();
    const spy = jasmine.createSpy();
    fixture.componentInstance.closed.subscribe(spy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(spy).toHaveBeenCalled();
  });
});
