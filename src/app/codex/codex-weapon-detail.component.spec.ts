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
    (fixture.nativeElement as HTMLElement)
      .querySelector('.wd-panel')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(spy).toHaveBeenCalled();
  });

  describe('countermeasure launcher (#242)', () => {
    // CNOU_Nomad_CML_Flare → BEHR_Flare, values from the live 4.10 extract.
    const LAUNCHER = {
      className: 'CNOU_Nomad_CML_Flare',
      subType: 'CountermeasureLauncher',
      weaponParams: { fireRate: 450, ammoCapacity: 48, ammoClassName: 'BEHR_Flare' },
    };
    const FLARE = {
      impactDamage: null,
      raw: {
        lifetime: 8,
        projectileParams: {
          typeParams: {
            _Type_: 'CounterMeasureFlareParams',
            StartInfrared: 20000,
            StartElectromagnetic: 20000,
            StartCrossSection: 6500,
          },
        },
      },
    };
    const cmEntry = (ammoPayload: unknown = FLARE): WeaponDetailEntry =>
      entry({ className: 'CNOU_Nomad_CML_Flare', name: 'Köderwerfer', payload: LAUNCHER, ammoPayload });
    const titles = (): string[] =>
      fixture.componentInstance.cards().map((c) => c.titleKey);
    const rowOf = (titleKey: string, labelKey: string): string | null | undefined =>
      fixture.componentInstance
        .cards()
        .find((c) => c.titleKey === titleKey)
        ?.rows.find((r) => r.labelKey === labelKey)?.value;

    it('drops the damage, derived and gun-gap cards when the round deals no damage', () => {
      fixture.componentRef.setInput('entry', cmEntry());
      fixture.detectChanges();
      expect(titles()).not.toContain('codex.weaponDetail.card.damageChannels');
      expect(titles()).not.toContain('codex.weaponDetail.card.derived');
      expect(titles()).not.toContain('codex.weaponDetail.card.missing');
      expect(titles()).toContain('codex.weaponDetail.card.cmDecoy');
      expect(titles()).toContain('codex.weaponDetail.card.cmRecommend');
    });

    it('shows the damage card again once the round carries damage', () => {
      fixture.componentRef.setInput('entry', cmEntry({ ...FLARE, impactDamage: { physical: 5 } }));
      fixture.detectChanges();
      expect(titles()).toContain('codex.weaponDetail.card.damageChannels');
    });

    it('lists the round signature and the launcher supply', () => {
      fixture.componentRef.setInput('entry', cmEntry());
      fixture.detectChanges();
      expect(rowOf('codex.weaponDetail.card.cmDecoy', 'codex.weaponDetail.row.cmIr')).toBe('20,000');
      expect(rowOf('codex.weaponDetail.card.cmDecoy', 'codex.weaponDetail.row.cmCs')).toBe('6,500');
      expect(rowOf('codex.weaponDetail.card.cmDecoy', 'codex.weaponDetail.row.cmCapacity')).toBe('48');
    });

    it('recommends floor(ship / round) + 1 per channel and names a missing ship value', () => {
      fixture.componentRef.setInput('entry', cmEntry());
      fixture.componentRef.setInput('shipSignature', { ir: 40000, em: null, crossSection: 6000 });
      fixture.detectChanges();
      const rec = 'codex.weaponDetail.card.cmRecommend';
      expect(rowOf(rec, 'codex.weaponDetail.row.shipIr')).toBe('40,000');
      // instant() without translations echoes the key; the count is the param.
      expect(rowOf(rec, 'codex.weaponDetail.row.cmNeedIr')).toBe('codex.weaponDetail.value.cmCount');
      expect(rowOf(rec, 'codex.weaponDetail.row.cmNeedEm')).toBe('codex.weaponDetail.value.noData');
      expect(rowOf(rec, 'codex.weaponDetail.row.shipEm')).toBe('codex.weaponDetail.value.noData');
    });
  });
});

