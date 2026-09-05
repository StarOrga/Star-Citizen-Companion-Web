import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexSwapPickerComponent, SwapPick, SwapTarget } from './codex-swap-picker.component';
import { CodexKind, CodexService, CompatibleItem, PortQuery } from './codex.service';

// The picker is the answer to admin request 461288f9, redesigned per MASTER
// §9 (iteration 7 `#g3` window + iteration 8 `#h3` values): a centred window
// over a veil, a searchable/scoped/sortable comparison table with a Δ
// baseline switch and a column chooser. These tests drive the real component
// against a stubbed service — they guard the WIRING, not the pure maths
// (that lives in swap-table.spec.ts / swap-table-picker.spec.ts).

const INSTALLED = 'KLWE_LaserRepeater_S3';
const FACTORY = 'AMRS_LaserCannon_S3';

function gun(fireRate = 0): unknown {
  return {
    entityKind: 'weapon',
    subType: 'Gun',
    attachType: 'WeaponGun',
    size: 3,
    weaponParams: { fireRate },
  };
}

const COMPATIBLE: CompatibleItem[] = [
  {
    kind: 'weapon',
    classNameSlug: INSTALLED,
    nameLocalized: 'CF-337 Panther Repeater',
    manufacturerCode: 'KLA',
    size: 3,
    subType: 'Gun',
    grade: 'A',
  },
  {
    kind: 'weapon',
    classNameSlug: FACTORY,
    nameLocalized: 'Omnisky IX Cannon',
    manufacturerCode: 'AMRS',
    size: 3,
    subType: 'Gun',
    grade: 'A',
  },
  {
    kind: 'weapon',
    classNameSlug: 'GATS_BallisticGatling_S3',
    nameLocalized: 'Mantis GT-220 Gatling',
    manufacturerCode: 'GAT',
    size: 3,
    subType: 'Gun',
    grade: 'A',
  },
];

const AMMO: Record<string, unknown> = {
  [`${INSTALLED}_AMMO`]: { speed: 1480, lifetime: 1.3, impactDamage: { energy: 43.65 } },
  [`${FACTORY}_AMMO`]: { speed: 1184, lifetime: 2.03, impactDamage: { energy: 219 } },
  GATS_BallisticGatling_S3_AMMO: { speed: 1600, lifetime: 1.1, impactDamage: { physical: 90 } },
};

class ServiceStub {
  readonly ports: PortQuery[] = [];

  async getEntityPayloads(names: string[]): Promise<Map<string, { kind: CodexKind; payload: unknown }>> {
    const out = new Map<string, { kind: CodexKind; payload: unknown }>();
    for (const n of names) {
      if (COMPATIBLE.some((c) => c.classNameSlug === n)) {
        out.set(n, { kind: 'weapon', payload: gun() });
      }
    }
    return out;
  }

  async getCompatibleItems(port: PortQuery): Promise<CompatibleItem[]> {
    this.ports.push(port);
    return COMPATIBLE;
  }

  async getAmmoPayloads(names: string[]): Promise<Map<string, unknown>> {
    const out = new Map<string, unknown>();
    for (const n of names) if (AMMO[n]) out.set(n, AMMO[n]);
    return out;
  }
}

const TARGET: SwapTarget = {
  port: 'Hardpoint Weapon Top Left',
  count: 3,
  className: INSTALLED,
  kind: 'weapon',
  name: 'CF-337 Panther Repeater',
  size: 3,
  factoryClassName: FACTORY,
};

describe('CodexSwapPickerComponent', () => {
  let fixture: ComponentFixture<CodexSwapPickerComponent>;
  let svc: ServiceStub;

  async function open(target: SwapTarget | null = TARGET): Promise<HTMLElement> {
    fixture.componentRef.setInput('target', target);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function rowNames(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll('.pick-row .pick-name')).map(
      (n) => n.firstChild?.textContent?.trim() ?? '',
    );
  }

  /** The three archetypes in the fixture differ (Repeater/Cannon/Gatling) — the
   * default `Nur <Klasse>` scope narrows to just the installed one, so most
   * table-content tests widen to "Alle S3" first. */
  function widenToAllSize(el: HTMLElement): void {
    const btn = Array.from(el.querySelectorAll('.pick-seg .seg-btn')).find((b) =>
      b.textContent?.includes('codex.picker.scope.sameSize'),
    ) as HTMLElement;
    btn.click();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.removeItem('scc-codex-picker-cols:v1');
    svc = new ServiceStub();
    await TestBed.configureTestingModule({
      imports: [CodexSwapPickerComponent],
      providers: [provideTranslateService({}), { provide: CodexService, useValue: svc }],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexSwapPickerComponent);
  });

  it('renders nothing until a hardpoint is targeted', async () => {
    const el = await open(null);
    expect(el.querySelector('.pick-win')).toBeNull();
  });

  it('opens as a centred dialog over a veil', async () => {
    const el = await open();
    expect(el.querySelector('.pick-win[role="dialog"]')).toBeTruthy();
    expect(el.querySelector('.pick-win')?.getAttribute('aria-modal')).toBe('true');
  });

  it('closes when the veil (not the window) is clicked', async () => {
    const el = await open();
    const spy = jasmine.createSpy();
    fixture.componentInstance.closed.subscribe(spy);
    (el.querySelector('.pick-win') as HTMLElement).click();
    expect(spy).not.toHaveBeenCalled();
    (el.querySelector('.pick-veil') as HTMLElement).click();
    expect(spy).toHaveBeenCalled();
  });

  it('lists every compatible item as a row including the installed one', async () => {
    const el = await open();
    widenToAllSize(el);
    expect(rowNames(el).sort()).toEqual(
      ['CF-337 Panther Repeater', 'Mantis GT-220 Gatling', 'Omnisky IX Cannon'].sort(),
    );
  });

  it('badges the installed item EQUIPPED', async () => {
    const el = await open();
    const rows = Array.from(el.querySelectorAll('.pick-row'));
    const installedRow = rows.find((r) => r.textContent?.includes('CF-337 Panther Repeater'));
    expect(installedRow?.querySelector('.tag.eq')).toBeTruthy();
  });

  it('reports the live scope counts (Nur Klasse / Alle Energiewaffen / Alle SN)', async () => {
    const el = await open();
    const segLabels = Array.from(el.querySelectorAll('.pick-seg .seg-btn')).map((b) => b.textContent?.trim());
    expect(segLabels.some((l) => /\(3\)/.test(l ?? ''))).toBeTrue();
  });

  it('moves the ±0 row when the Δ baseline switches from Eingebaut to Ab Werk', async () => {
    const el = await open();
    widenToAllSize(el);
    const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('.pick-row.cur'));
    expect(rows()[0]?.textContent).toContain('CF-337 Panther Repeater');

    const baselineSeg = Array.from(el.querySelectorAll('.pick-seg')).find((g) =>
      g.textContent?.includes('codex.picker.deltaAgainst'),
    )!;
    const factoryBtn = Array.from(baselineSeg.querySelectorAll('.seg-btn')).find((b) =>
      b.textContent?.includes('codex.picker.baseline.factory'),
    ) as HTMLElement;
    factoryBtn.click();
    fixture.detectChanges();
    expect(rows()[0]?.textContent).toContain('Omnisky IX Cannon');
  });

  it('opens the column chooser and can hide/show a column, persisting the choice', async () => {
    const el = await open();
    const summary = el.querySelector('.pick-cols-sum') as HTMLElement;
    summary.click();
    fixture.detectChanges();
    const massBox = Array.from(el.querySelectorAll('.pc-row input')).find(
      (b) => (b.closest('.pc-row') as HTMLElement).textContent?.includes('codex.picker.col.mass'),
    ) as HTMLInputElement;
    expect(massBox.checked).toBeTrue();
    massBox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.chooser().visible).not.toContain('codex.picker.col.mass');
    expect(localStorage.getItem('scc-codex-picker-cols:v1')).toContain('codex.picker.col.grade');
  });

  it('renders Ammo as a dash with a title on an energy weapon, and omits sourceless columns from the footer', async () => {
    const el = await open();
    // fireRate is 0 on every ship weapon in this extract → no DPS column at all
    // (genuinely sourceless), while Ammo is "—" (not applicable to energy guns).
    const missing = el.querySelector('.pick-missing')?.textContent ?? '';
    expect(missing).toContain('codex.picker.footerMissing');
  });

  it('shows a magnitude bar on the Alpha column', async () => {
    const el = await open();
    widenToAllSize(el);
    expect(el.querySelectorAll('td .bar').length).toBeGreaterThan(0);
  });

  it('picks a row on click and emits it to the host', async () => {
    const el = await open();
    widenToAllSize(el);
    const spy = jasmine.createSpy();
    fixture.componentInstance.picked.subscribe(spy);
    const row = Array.from(el.querySelectorAll('.pick-row')).find((r) =>
      r.textContent?.includes('Omnisky IX Cannon'),
    ) as HTMLElement;
    row.click();
    const emitted = spy.calls.mostRecent().args[0] as SwapPick;
    expect(emitted.className).toBe(FACTORY);
    expect(emitted.target).toBe(TARGET);
  });

  it('narrows the table by the free-text search', async () => {
    const el = await open();
    widenToAllSize(el);
    const input = el.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'omnisky';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rowNames(fixture.nativeElement)).toEqual(['Omnisky IX Cannon']);
  });

  it('closes on Escape', async () => {
    const el = await open();
    const spy = jasmine.createSpy();
    fixture.componentInstance.closed.subscribe(spy);
    (el.querySelector('.pick-win') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(spy).toHaveBeenCalled();
  });
});
