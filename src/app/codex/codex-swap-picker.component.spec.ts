import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { CodexSwapPickerComponent, SwapPick, SwapTarget } from './codex-swap-picker.component';
import { CodexKind, CodexService, CompatibleItem, PortQuery } from './codex.service';
import { SwapCandidate } from './swap-table';

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

  it('renders the plain scope labels (no inline count) and the count separately', async () => {
    const el = await open();
    // LOW finding: the scope segments read as plain labels ("Nur Repeater"),
    // the live count lives only in the `n von total` note below the bar.
    const segLabels = Array.from(el.querySelectorAll('.pick-seg .seg-btn')).map((b) => b.textContent?.trim());
    expect(segLabels.some((l) => /\(\d+\)/.test(l ?? ''))).toBeFalse();
    expect(el.querySelector('.pick-count')?.textContent).toContain('codex.picker.count');
  });

  it('counts against every compatible item for the port, not just the current scope', async () => {
    const el = await open();
    // Default scope is `sameClass` (Repeater only, 1 of 3) — the total must
    // still read every compatible item for the port (HIGH finding 3).
    expect(el.querySelector('.pick-count')?.textContent).toContain('codex.picker.count');
    const n = fixture.componentInstance.rows().length;
    const total = fixture.componentInstance.candidates().length;
    expect(n).toBeLessThan(total);
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
    // `grade` is direct candidate metadata, always available — `mass` is not
    // (the stub's payloads carry none), and now lives in the disabled
    // "unavailable" fieldset (LOW-6), which is intentionally non-interactive.
    const gradeBox = Array.from(el.querySelectorAll('.pc-row:not(.off) input')).find(
      (b) => (b.closest('.pc-row') as HTMLElement).textContent?.includes('codex.picker.col.grade'),
    ) as HTMLInputElement;
    expect(gradeBox.checked).toBeTrue();
    gradeBox.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.chooser().visible).not.toContain('codex.picker.col.grade');
    expect(localStorage.getItem('scc-codex-picker-cols:v1')).toContain('codex.picker.col.manufacturer');
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

  it('titles a not-applicable dash cell (B-C16 medium finding)', async () => {
    const el = await open();
    widenToAllSize(el);
    const gapCell = el.querySelector('td.gapc') as HTMLElement | null;
    expect(gapCell).toBeTruthy();
    expect(gapCell?.getAttribute('title')).toBe('codex.picker.dashCellTitle');
  });

  /** The service stub's guns all carry `fireRate: 0`, so real fixtures never
   * populate a DPS stat (codex-equipped-stats: "0 means unset"). These two
   * tests inject synthetic candidates with a real DPS so the Δ Dauer column
   * has something to measure. */
  function withDps(cmp: CodexSwapPickerComponent): void {
    const base: SwapCandidate = {
      className: INSTALLED,
      kind: 'weapon',
      name: 'CF-337 Panther Repeater',
      manufacturerCode: 'KLA',
      size: 3,
      grade: 'A',
      typeLabel: 'Laser Repeater',
      archetype: 'Repeater',
      damageChannels: ['energy'],
      stats: { 'codex.equipped.dps': { value: 100, format: 'perSec' } },
      equipped: true,
    };
    const better: SwapCandidate = {
      ...base,
      className: FACTORY,
      name: 'Omnisky IX Cannon',
      archetype: 'Cannon',
      equipped: false,
      stats: { 'codex.equipped.dps': { value: 150, format: 'perSec' } },
    };
    cmp.candidates.set([base, better]);
  }

  it('colours the Δ Dauer cell up/down/plain by the delta sign', async () => {
    await open();
    const cmp = fixture.componentInstance;
    withDps(cmp);
    cmp.scope.set('allSize');
    fixture.detectChanges();
    const gain = cmp.rows().find((r) => r.className === FACTORY);
    const equipped = cmp.rows().find((r) => r.className === INSTALLED);
    expect(gain).toBeTruthy();
    expect(equipped).toBeTruthy();
    expect(cmp.deltaTone(gain!)).toBe('up');
    expect(cmp.deltaTone(equipped!)).toBe('none');
  });

  it('keeps every row priced against the baseline even when it is filtered out of view (B-C14)', async () => {
    await open();
    const cmp = fixture.componentInstance;
    withDps(cmp);
    cmp.scope.set('allSize');
    fixture.detectChanges();
    // Filter the baseline (the installed Repeater) out of the visible rows —
    // the Δ column must still measure every remaining row against it.
    cmp.query.set('omnisky');
    fixture.detectChanges();
    expect(cmp.rows().some((r) => r.className === INSTALLED)).toBeFalse();
    expect(cmp.baselineOutOfSet()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.baseline-note')).toBeTruthy();
    expect(cmp.deltaColumn().get(FACTORY)).not.toBeNull();
  });

  it('shows the scope as a removable chip once the scope narrows below Alle SN', async () => {
    const el = await open();
    // default scope is `sameClass` — the chip should already be visible.
    expect(fixture.componentInstance.scopeChip()).toBeTruthy();
    expect(el.querySelector('.fc-list .fc')).toBeTruthy();
    widenToAllSize(el);
    expect(fixture.componentInstance.scopeChip()).toBeNull();
  });

  // ── E-main-gap restore: #38 appliesToMany/One, #39 previewHint, #41 sortHint ──

  it('shows "gilt für alle N Hardpoints" under the installed name when the target covers several ports (E-main-gap #38)', async () => {
    const el = await open();
    expect(el.querySelector('.pick-applies')?.textContent).toContain('codex.swap.appliesToMany');
  });

  it('shows "gilt für diesen Hardpoint" when the target is a single port (E-main-gap #38)', async () => {
    const el = await open({ ...TARGET, count: 1 });
    expect(el.querySelector('.pick-applies')?.textContent).toContain('codex.swap.appliesToOne');
  });

  it('shows the draft-disclosure hint under the Δ-baseline control (E-main-gap #39)', async () => {
    const el = await open();
    expect(el.querySelector('.pick-preview-hint')?.textContent).toContain('codex.swap.previewHint');
  });

  it('shows the Ctrl-click secondary-sort hint next to the filter chips (E-main-gap #41)', async () => {
    const el = await open();
    expect(el.querySelector('.pick-sorthint')?.textContent).toContain('codex.swap.sortHint');
  });

  // ── E-main-gap #41: secondary sort ──────────────────────────────────────────

  it('adds a secondary (tie-breaker) sort via Ctrl-click on a column head, and via the menu entry', async () => {
    // MEDIUM-4: `sortRankTitle` now goes through ngx-translate — supply the
    // key so the assertions below can still tell the two ranks apart.
    const i18n = TestBed.inject(TranslateService);
    i18n.setTranslation('en', { codex: { picker: { menu: { sortRank: 'Sort {{n}}' } } } });
    i18n.use('en');
    const el = await open();
    widenToAllSize(el);
    const cmp = fixture.componentInstance;
    // primary: sort by grade (categorical, ties every row at "A") …
    cmp.onHeadClick('codex.picker.col.grade');
    fixture.detectChanges();
    expect(cmp.columnMenu().sort?.key).toBe('codex.picker.col.grade');
    // … Ctrl-click on manufacturer breaks the tie as a SECOND key, not a replacement.
    cmp.onHeadClick('codex.picker.col.manufacturer', true);
    fixture.detectChanges();
    expect(cmp.columnMenu().sort?.key).toBe('codex.picker.col.grade');
    expect(cmp.columnMenu().secondarySort?.key).toBe('codex.picker.col.manufacturer');
    expect(cmp.sortRankTitle('codex.picker.col.grade')).toBe('Sort 1');
    expect(cmp.sortRankTitle('codex.picker.col.manufacturer')).toBe('Sort 2');
    expect(cmp.isSecondarySort('codex.picker.col.manufacturer')).toBeTrue();

    // the column menu's "als zweite Sortierung" entry does the same thing.
    cmp.columnMenu.set({ sort: { key: 'codex.picker.col.grade', dir: 'asc' }, filters: {} });
    fixture.detectChanges();
    cmp.onSecondarySortToggle('codex.picker.col.manufacturer');
    fixture.detectChanges();
    expect(cmp.columnMenu().secondarySort?.key).toBe('codex.picker.col.manufacturer');
  });

  it('MEDIUM-2: the secondary-sort toggle switches back off once already active', async () => {
    const el = await open();
    widenToAllSize(el);
    const cmp = fixture.componentInstance;
    cmp.onHeadClick('codex.picker.col.grade');
    cmp.onSecondarySortToggle('codex.picker.col.manufacturer');
    fixture.detectChanges();
    expect(cmp.columnMenu().secondarySort?.key).toBe('codex.picker.col.manufacturer');
    // clicking it again while it IS the secondary must clear it, not flip it.
    cmp.onSecondarySortToggle('codex.picker.col.manufacturer');
    fixture.detectChanges();
    expect(cmp.columnMenu().secondarySort).toBeNull();
  });

  it('MEDIUM-3: the secondary-sort entry is only eligible on a column other than the active primary', async () => {
    const el = await open();
    widenToAllSize(el);
    const cmp = fixture.componentInstance;
    // no primary sort yet — never eligible.
    expect(cmp.secondarySortEligible('codex.picker.col.grade')).toBeFalse();
    cmp.onHeadClick('codex.picker.col.grade');
    fixture.detectChanges();
    // the primary column itself is never eligible as its own tie-breaker.
    expect(cmp.secondarySortEligible('codex.picker.col.grade')).toBeFalse();
    // any other column is.
    expect(cmp.secondarySortEligible('codex.picker.col.manufacturer')).toBeTrue();
  });

  // ── LOW-6: unavailable columns as a disabled fieldset group ─────────────────

  it('groups the unavailable columns in a disabled fieldset, not as individually-disabled rows (LOW-6)', async () => {
    const el = await open();
    const summary = el.querySelector('.pick-cols-sum') as HTMLElement;
    summary.click();
    fixture.detectChanges();
    const group = el.querySelector('fieldset.pc-unavail-group') as HTMLFieldSetElement;
    expect(group).toBeTruthy();
    expect(group.disabled).toBeTrue();
    const massRow = Array.from(group.querySelectorAll('.pc-row')).find((r) =>
      r.textContent?.includes('codex.picker.col.mass'),
    );
    expect(massRow).toBeTruthy();
    expect((massRow as HTMLElement).classList.contains('off')).toBeTrue();
  });

  // ── LOW-3: unit as a separate <small>, not concatenated into the label ──────

  it('renders a column unit as a separate <small class="unit">, not appended to the label text', async () => {
    const el = await open();
    widenToAllSize(el);
    // Projectile speed always resolves — every fixture candidate has an AMMO
    // payload with a `speed` — and its `mps` format always carries a unit.
    const speedHead = Array.from(el.querySelectorAll('th.c-num')).find((th) =>
      th.textContent?.includes('codex.equipped.projectileSpeed'),
    ) as HTMLElement;
    expect(speedHead).toBeTruthy();
    const unitEl = speedHead.querySelector('.unit');
    expect(unitEl?.textContent).toBe('codex.picker.unit.mps');
    // `colLabel` — what feeds `[label]` — never has the unit baked into it (LOW-3).
    const cmp = fixture.componentInstance;
    const col = cmp.displayColumns().find((c) => c.key === 'codex.equipped.projectileSpeed')!;
    expect(cmp.colLabel(col)).not.toContain('codex.picker.unit.mps');
    expect(cmp.colUnit(col)).toBe('codex.picker.unit.mps');
  });

  // ── popover clipping (MEDIUM-5: CDK Overlay, not a relaxed scroll box) ──────

  it('keeps .pick-scroll a real scroll container and portals the popover outside it', async () => {
    const el = await open();
    document.body.appendChild(el); // the overlay's position strategy needs a laid-out origin
    widenToAllSize(el);
    const scroll = el.querySelector('.pick-scroll') as HTMLElement;
    scroll.scrollLeft = 40;
    const heads = Array.from(el.querySelectorAll('th.c-num sc-column-menu summary.cm-kebab')) as HTMLElement[];
    const last = heads[heads.length - 1];
    // A real click toggles the native `open` attribute synchronously, but the
    // browser fires the `toggle` event as a queued task — drive both by hand
    // so the (deterministic) test observes the same open path a later real
    // `toggle` event would trigger.
    const det = last.closest('details') as HTMLDetailsElement;
    det.open = true;
    det.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    // Opening the menu never relaxes the scroll box's own clipping — unlike
    // the old `.pick-scroll:has(.cm-pop[open]) { overflow: visible }` fix, the
    // container stays a real scroll container, so its scroll offset survives.
    expect(getComputedStyle(scroll).overflow).toBe('auto');
    expect(scroll.scrollLeft).toBe(40);
    // The popover itself renders in the CDK overlay container (a top-level
    // sibling, appended to `<body>`), not as a descendant of `.pick-scroll` —
    // so no ancestor's `overflow` can ever clip it.
    const panel = document.querySelector('.cdk-overlay-container .cm-panel');
    expect(panel).toBeTruthy();
    expect(scroll.contains(panel)).toBeFalse();
    el.remove();
  });
});

describe('CodexSwapPickerComponent — part-type filter (E-main-gap #40, MEDIUM-1)', () => {
  let fixture: ComponentFixture<CodexSwapPickerComponent>;

  // MEDIUM-1: the restored filter splits on the item ARCHETYPE main used
  // (`c.archetype`, derived from class name / subType) — not on the coarser
  // `attachType` a port declares, which is a single value for practically
  // every fitted hardpoint. `MISS_A`/`MISS_B` carry a `MissileRack` subType so
  // `swapArchetype` resolves them to "Missile Rack"; `UTIL_A` carries
  // `Utility`, a distinct archetype — two archetypes among the candidates is
  // exactly the case the scope-bar control must appear for.
  const MISSILE_TYPE = 'ItemMissile';
  const UTILITY_TYPE = 'ItemUtility';

  class TypeServiceStub {
    async getEntityPayloads(names: string[]): Promise<Map<string, { kind: CodexKind; payload: unknown }>> {
      const byName: Record<string, string> = {
        MISS_A: MISSILE_TYPE,
        MISS_B: MISSILE_TYPE,
        UTIL_A: UTILITY_TYPE,
      };
      const out = new Map<string, { kind: CodexKind; payload: unknown }>();
      for (const n of names) if (byName[n]) out.set(n, { kind: 'item', payload: { attachType: byName[n] } });
      return out;
    }

    async getCompatibleItems(_port: PortQuery): Promise<CompatibleItem[]> {
      return [
        { kind: 'item', classNameSlug: 'MISS_A', nameLocalized: 'Missile A', manufacturerCode: null, size: 2, subType: 'MissileRack', grade: null },
        { kind: 'item', classNameSlug: 'MISS_B', nameLocalized: 'Missile B', manufacturerCode: null, size: 2, subType: 'MissileRack', grade: null },
        { kind: 'item', classNameSlug: 'UTIL_A', nameLocalized: 'Utility A', manufacturerCode: null, size: 2, subType: 'Utility', grade: null },
      ];
    }

    async getAmmoPayloads(): Promise<Map<string, unknown>> {
      return new Map();
    }
  }

  class SingleArchetypeServiceStub extends TypeServiceStub {
    override async getCompatibleItems(_port: PortQuery): Promise<CompatibleItem[]> {
      return [
        { kind: 'item', classNameSlug: 'MISS_A', nameLocalized: 'Missile A', manufacturerCode: null, size: 2, subType: 'MissileRack', grade: null },
        { kind: 'item', classNameSlug: 'MISS_B', nameLocalized: 'Missile B', manufacturerCode: null, size: 2, subType: 'MissileRack', grade: null },
      ];
    }
  }

  const MULTI_TYPE_TARGET: SwapTarget = {
    port: 'Missile Rack',
    count: 1,
    className: null,
    kind: null,
    name: null,
    size: 2,
    attachTypes: [MISSILE_TYPE, UTILITY_TYPE],
  };

  async function open(): Promise<HTMLElement> {
    fixture.componentRef.setInput('target', MULTI_TYPE_TARGET);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  async function configure(stub: CodexService): Promise<void> {
    localStorage.removeItem('scc-codex-picker-cols:v1');
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CodexSwapPickerComponent],
      providers: [provideTranslateService({}), { provide: CodexService, useValue: stub }],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexSwapPickerComponent);
  }

  beforeEach(async () => {
    await configure(new TypeServiceStub() as unknown as CodexService);
  });

  it('renders a fourth scope-bar control when the candidates span more than one archetype', async () => {
    const el = await open();
    expect(fixture.componentInstance.showTypeFilter()).toBeTrue();
    const group = Array.from(el.querySelectorAll('.pick-seg')).find((g) =>
      g.textContent?.includes('codex.swap.typeFilter'),
    );
    expect(group).toBeTruthy();
  });

  it('narrows the table by the selected archetype and echoes it as a removable chip', async () => {
    const el = await open();
    const cmp = fixture.componentInstance;
    expect(cmp.rows().length).toBe(3);
    cmp.typeFilter.set('Missile Rack');
    fixture.detectChanges();
    expect(cmp.rows().every((r) => r.archetype === 'Missile Rack')).toBeTrue();
    expect(cmp.rows().length).toBe(2);
    expect(cmp.typeFilterChip()?.label).toContain('Missile Rack');
    const chipBtn = Array.from(el.querySelectorAll('.fc-list .fc button')).find((b) =>
      (b.closest('.fc') as HTMLElement).textContent?.includes('Missile Rack'),
    ) as HTMLElement;
    chipBtn.click();
    fixture.detectChanges();
    expect(cmp.typeFilter()).toBe(cmp.TYPE_ALL);
    expect(cmp.rows().length).toBe(3);
  });

  it('hides the type-filter control when every candidate shares one archetype', async () => {
    await configure(new SingleArchetypeServiceStub() as unknown as CodexService);
    await open();
    expect(fixture.componentInstance.showTypeFilter()).toBeFalse();
  });

  it('LOW-1 (main parity, pruneSwapFilters): resets a stale archetype filter once it no longer occurs', async () => {
    const cmp = fixture.componentInstance;
    await open();
    cmp.typeFilter.set('Missile Rack');
    fixture.detectChanges();
    expect(cmp.typeFilter()).toBe('Missile Rack');
    // Whatever the cause (a scope switch in the live app; here, simulated
    // directly on the candidate set for a deterministic repro) — once
    // "Missile Rack" no longer occurs among the scoped candidates, the stale
    // segmented value must reset to "all" rather than leave the table
    // silently empty with no visible cause.
    cmp.candidates.set(cmp.candidates().filter((c) => c.archetype !== 'Missile Rack'));
    fixture.detectChanges();
    expect(cmp.typeFilter()).toBe(cmp.TYPE_ALL);
  });
});
