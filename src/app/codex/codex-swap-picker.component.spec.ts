import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexSwapPickerComponent, SwapTarget } from './codex-swap-picker.component';
import { CodexKind, CodexService, CompatibleItem, PortQuery } from './codex.service';

// The picker is the answer to the "Swap weapon" reference the admin posted:
// a table of everything that fits, searchable, filterable, sortable, with the
// installed item marked. These tests drive the real component against a stubbed
// service, so they guard the WIRING (does a click sort, does a filter narrow,
// does the equipped row survive) rather than the pure maths in swap-table.spec.

const INSTALLED = 'KLWE_LaserRepeater_S3';

function gun(subType = 'Gun'): unknown {
  return {
    entityKind: 'weapon',
    subType,
    attachType: 'WeaponGun',
    size: 3,
    weaponParams: { fireRate: 0 },
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
    classNameSlug: 'AMRS_LaserCannon_S3',
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
  AMRS_LaserCannon_S3_AMMO: { speed: 1184, lifetime: 2.03, impactDamage: { energy: 219 } },
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
    // The name node also carries the damage / EQUIPPED tags — take its own text.
    return Array.from(el.querySelectorAll('.sp-row .pick-name')).map(
      (n) => n.firstChild?.textContent?.trim() ?? '',
    );
  }

  beforeEach(async () => {
    svc = new ServiceStub();
    await TestBed.configureTestingModule({
      imports: [CodexSwapPickerComponent],
      providers: [
        provideTranslateService({}),
        { provide: CodexService, useValue: svc },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexSwapPickerComponent);
  });

  it('renders nothing until a hardpoint is targeted', async () => {
    const el = await open(null);
    expect(el.querySelector('.sp-panel')).toBeNull();
  });

  it('asks the compatibility RPC for the installed item’s attach type and size', async () => {
    await open();
    expect(svc.ports).toEqual([{ types: ['WeaponGun'], minSize: 3, maxSize: 3 }]);
  });

  it('lists every compatible item as a row, best value first', async () => {
    const el = await open();
    expect(rowNames(el)).toEqual([
      'Omnisky IX Cannon',
      'Mantis GT-220 Gatling',
      'CF-337 Panther Repeater',
    ]);
  });

  it('keeps the installed item in the table and badges it EQUIPPED', async () => {
    const el = await open();
    const equipped = el.querySelector('.sp-row.equipped');
    expect(equipped).toBeTruthy();
    expect(equipped?.querySelector('.pick-name')?.firstChild?.textContent?.trim()).toBe(
      'CF-337 Panther Repeater',
    );
    expect(equipped?.querySelector('.tag.eq')).toBeTruthy();
  });

  it('renders only the columns the data can fill', async () => {
    const el = await open();
    const heads = Array.from(el.querySelectorAll('thead .hd')).map((h) =>
      h.textContent?.trim().replace(/[▲▼\d*]/g, '').trim(),
    );
    // fireRate is 0 on every ship weapon in this extract → no rate, no DPS.
    expect(heads).toContain('codex.equipped.alphaDamage');
    expect(heads).not.toContain('codex.equipped.fireRate');
    expect(heads).not.toContain('codex.equipped.dps');
    // …and the footer says so instead of showing twelve empty cells.
    expect(el.querySelector('.sp-missing')?.textContent).toContain('codex.swap.missingColumns');
  });

  it('inverts the sort when the same header is clicked again', async () => {
    const el = await open();
    const alpha = Array.from(el.querySelectorAll<HTMLButtonElement>('thead .hd')).find((h) =>
      h.textContent?.includes('alphaDamage'),
    )!;
    alpha.click();
    fixture.detectChanges();
    expect(rowNames(fixture.nativeElement)[0]).toBe('CF-337 Panther Repeater'); // weakest first
    expect(alpha.closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('adds a secondary sort on Ctrl-click and marks the order', async () => {
    const el = await open();
    const heads = Array.from(el.querySelectorAll<HTMLButtonElement>('thead .hd'));
    heads[0].dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }));
    fixture.detectChanges();
    const marks = Array.from(fixture.nativeElement.querySelectorAll('.hd-dir'))
      .map((m) => (m as HTMLElement).textContent?.trim())
      .filter(Boolean);
    expect(marks).toEqual(['▲2', '▼1']);
  });

  it('narrows the table by the free-text search', async () => {
    const el = await open();
    const input = el.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'amrs';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rowNames(fixture.nativeElement)).toEqual(['Omnisky IX Cannon']);
  });

  it('offers the damage filter the mixed result set actually supports', async () => {
    const el = await open();
    const groups = Array.from(el.querySelectorAll('.sp-group-label')).map((l) =>
      l.textContent?.trim(),
    );
    expect(groups).toEqual(['codex.swap.damageFilter', 'codex.swap.typeFilter']);
    const ballistic = Array.from(el.querySelectorAll<HTMLButtonElement>('.pill')).find((p) =>
      p.textContent?.includes('physical'),
    )!;
    ballistic.click();
    fixture.detectChanges();
    expect(rowNames(fixture.nativeElement)).toEqual(['Mantis GT-220 Gatling']);
  });

  it('previews the stat change against what is installed, and saves nothing', async () => {
    const el = await open();
    const omnisky = Array.from(el.querySelectorAll<HTMLButtonElement>('.pick')).find((b) =>
      b.textContent?.includes('Omnisky'),
    )!;
    omnisky.click();
    fixture.detectChanges();
    const delta = fixture.nativeElement.querySelector('.sp-delta');
    expect(delta).toBeTruthy();
    expect(delta.textContent).toContain('+402%');
    // Sandbox contract: no apply/save action exists at all.
    expect(fixture.nativeElement.querySelector('.sp-foot button')?.textContent?.trim()).toBe(
      'codex.swap.cancel',
    );
  });

  it('reports how many identical hardpoints the choice would apply to', async () => {
    const el = await open();
    expect(el.querySelector('.sp-applies')?.textContent).toContain('codex.swap.appliesToMany');
    expect(el.querySelector('.sp-applies')?.textContent).toContain('codex.swap.matched');
  });

  it('closes on ESC and on a backdrop click', async () => {
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => (closes += 1));
    const el = await open();
    (el.querySelector('.sp-panel') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    (el.querySelector('.sp-backdrop') as HTMLElement).click();
    expect(closes).toBe(2);
  });

  it('is a labelled modal dialog', async () => {
    const el = await open();
    const panel = el.querySelector('.sp-panel')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('aria-label')).toBe('codex.swap.pickerTitle');
  });

  it('says so instead of spinning when the hardpoint has no attach type', async () => {
    const el = await open({ ...TARGET, className: 'UNRESOLVABLE' });
    expect(el.querySelector('.sp-msg')?.textContent).toContain('codex.swap.none');
    expect(svc.ports.length).toBe(0);
  });

  // ── unfitted bays (admin request 1add86a4) ────────────────────────────────

  it('lists candidates for a bay that ships EMPTY, from its declared fit', async () => {
    // The Nomad's `hardpoint_shield_generator_01`: nothing installed, so there
    // is no attachType to read — the caller declares what the bay accepts.
    const el = await open({
      port: 'Hardpoint Shield Generator 01',
      count: 1,
      className: null,
      kind: null,
      name: null,
      size: 1,
      attachTypes: ['Shield'],
      fitInferred: true,
    });
    expect(svc.ports).toEqual([{ types: ['Shield'], minSize: 1, maxSize: 1 }]);
    expect(rowNames(el).length).toBe(COMPATIBLE.length);
    // Nothing is installed, so no row may claim to be.
    expect(el.querySelector('.tag.eq')).toBeNull();
    expect(el.querySelector('.sp-sub')?.textContent).toContain('codex.swap.installedNone');
  });

  it('admits when the candidate list was inferred from a sibling bay', async () => {
    const base: SwapTarget = {
      port: 'Hardpoint Shield Generator 01',
      count: 1,
      className: null,
      kind: null,
      name: null,
      size: 1,
      attachTypes: ['Shield'],
    };
    const inferred = await open({ ...base, fitInferred: true });
    expect(inferred.querySelector('.sp-hint.inferred')?.textContent).toContain(
      'codex.swap.fitInferred',
    );
    await open(null);
    const direct = await open(base);
    expect(direct.querySelector('.sp-hint.inferred')).toBeNull();
  });

  it('stays empty for a bay nothing declares a fit for', async () => {
    const el = await open({
      port: 'Hardpoint Weapon Bottom',
      count: 1,
      className: null,
      kind: null,
      name: null,
      size: null,
    });
    expect(el.querySelector('.sp-msg')?.textContent).toContain('codex.swap.none');
    expect(svc.ports.length).toBe(0);
  });
});
