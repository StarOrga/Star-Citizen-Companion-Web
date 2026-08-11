import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  CodexHardpointLayoutComponent,
  LayoutChild,
  LayoutSection,
  LayoutSlot,
  LayoutTarget,
} from './codex-hardpoint-layout.component';

// Renders the real component, so these guard the *structure* the reference
// layout asked for — the mounted item's name as the headline, its size class
// beside it, the maker/type line under it, and the port name demoted to
// context. A pure-function test cannot catch a template that silently renders
// nothing (the identity block is an ngTemplateOutlet).

function slot(over: Partial<LayoutSlot> & { port: string }): LayoutSlot {
  return {
    className: null,
    kind: null,
    name: null,
    size: null,
    grade: null,
    manufacturerCode: null,
    ...over,
  };
}

function child(over: Partial<LayoutChild> & { port: string }): LayoutChild {
  return {
    typeLabel: null,
    size: null,
    className: null,
    kind: null,
    name: null,
    count: 1,
    ...over,
  };
}

const PANTHER = slot({
  port: 'Hardpoint Weapon Top Left',
  className: 'KLWE_LaserRepeater_S3',
  kind: 'weapon',
  name: 'CF-337 Panther Repeater',
  size: 3,
  grade: 'A',
  manufacturerCode: 'KLA',
  typeLabel: 'Gun',
  damageChannels: ['energy'],
  stats: [
    { labelKey: 'codex.equipped.alphaDamage', value: 43.65, format: 'dec' },
    { labelKey: 'codex.equipped.projectileSpeed', value: 1480, format: 'mps' },
    { labelKey: 'codex.equipped.range', value: 1924, format: 'metres', derived: true },
    { labelKey: 'codex.equipped.penetration', value: 0.085, format: 'metresDec' },
  ],
});

// A gimbal mount with the gun seat it exposes — the pairing the admin asked
// for ("3x S3 VariPuck … > 3x S3 CF-337 Panther Repeater").
const VARIPUCK = slot({
  port: 'Hardpoint Weapon Wing Left',
  className: 'Mount_Gimbal_S3',
  kind: 'weapon',
  name: 'VariPuck S3 Gimbal Mount',
  size: 3,
  grade: 'A',
  manufacturerCode: 'FFSY',
  typeLabel: 'Gun Turret',
  children: [child({ port: 'Hardpoint Class 3', typeLabel: 'Weapon Gun', size: 3 })],
});

describe('CodexHardpointLayoutComponent', () => {
  let fixture: ComponentFixture<CodexHardpointLayoutComponent>;

  function render(sections: LayoutSection[]): HTMLElement {
    fixture.componentRef.setInput('sections', sections);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Render and open the airframe block, which ships folded away (32659942).
   * Tests about what a fixed ROW looks like are not tests about the fold, so
   * they open it the way a reader would and carry on.
   */
  function renderUnfolded(sections: LayoutSection[]): HTMLElement {
    const el = render(sections);
    const fold = el.querySelector(
      '.mod-sec[data-sec="structure"] .sec-btn.fold',
    ) as HTMLButtonElement | null;
    fold?.click();
    fixture.detectChanges();
    return el;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexHardpointLayoutComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexHardpointLayoutComponent);
  });

  it('leads with the mounted weapon, not with the port name', () => {
    const el = render([{ section: 'weapons', slots: [PANTHER] }]);
    expect(el.querySelector('.slot-item')?.textContent?.trim()).toBe('CF-337 Panther Repeater');
    expect(el.querySelector('.size-tag')?.textContent?.trim()).toBe('S3');
    expect(el.querySelector('.slot-port')?.textContent?.trim()).toBe('Hardpoint Weapon Top Left');
  });

  it('shows who made it and what it is on one meta line', () => {
    const el = render([{ section: 'weapons', slots: [PANTHER] }]);
    expect(el.querySelector('.meta-txt')?.textContent?.trim()).toBe('KLA · Gun');
    expect(el.querySelector('.tag.dmg')).toBeTruthy(); // the ENERGY badge
  });

  it('renders every curated stat with its unit', () => {
    const el = render([{ section: 'weapons', slots: [PANTHER] }]);
    const values = Array.from(el.querySelectorAll('.slot-stats dd')).map((d) =>
      d.textContent?.trim(),
    );
    expect(values).toEqual(['43.65', '1,480 m/s', '1,924 m', '0.09 m']);
    // Derived rows stay marked so nobody reads them as extracted values.
    expect(el.querySelectorAll('.slot-stats .derived').length).toBe(1);
  });

  it('collapses identical mounts into one "3× S3" row without faking a position', () => {
    const el = render([
      {
        section: 'weapons',
        slots: [
          { ...PANTHER, port: 'Hardpoint Weapon Top Left' },
          { ...PANTHER, port: 'Hardpoint Weapon Top Right' },
          { ...PANTHER, port: 'Hardpoint Weapon Bottom' },
        ],
      },
    ]);
    expect(el.querySelectorAll('.slot').length).toBe(1);
    expect(el.querySelector('.size-tag')?.textContent?.trim()).toBe('3× S3');
    expect(el.querySelector('.slot-port')?.textContent?.trim()).toBe(
      '3× Hardpoint Weapon (Top Left / Top Right / Bottom)',
    );
  });

  it('omits the meta line entirely when the extract identifies nothing', () => {
    const bare = slot({ port: 'Hardpoint X', className: 'X', kind: 'item', name: 'X' });
    const el = renderUnfolded([{ section: 'structure', slots: [bare] }]);
    expect(el.querySelector('.meta-txt')).toBeNull();
    expect(el.querySelector('.tag')).toBeNull();
    expect(el.querySelector('.slot-item')?.textContent?.trim()).toBe('X');
  });

  it('marks a stock-empty mount as empty instead of inventing an occupant', () => {
    const el = render([{ section: 'weapons', slots: [slot({ port: 'Hardpoint Weapon Bottom' })] }]);
    expect(el.querySelector('.slot')?.classList).toContain('empty');
    expect(el.querySelector('.slot-empty')).toBeTruthy();
    expect(el.querySelector('.slot-item')).toBeNull();
  });

  it('badges an empty mount with the size the HARDPOINT accepts', () => {
    const el = render([
      { section: 'weapons', slots: [slot({ port: 'Hardpoint Gun Nose', portSize: 4 })] },
    ]);
    expect(el.querySelector('.size-tag')?.textContent?.trim()).toBe('S4');
    expect(el.querySelector('.size-tag')?.classList).toContain('muted');
  });

  it('chains the mount to the weapon seat inside it, counted per mount', () => {
    const el = render([
      {
        section: 'weapons',
        slots: [
          { ...VARIPUCK, port: 'Hardpoint Weapon Wing Left' },
          { ...VARIPUCK, port: 'Hardpoint Weapon Wing Right' },
          { ...VARIPUCK, port: 'Hardpoint Weapon Nose' },
        ],
      },
    ]);
    // One collapsed row: the mount headline, then its sub-slot beside it.
    expect(el.querySelectorAll('.slot').length).toBe(1);
    expect(el.querySelector('.slot-item')?.textContent?.trim()).toBe('VariPuck S3 Gimbal Mount');
    const kid = el.querySelector('.kid');
    expect(kid).toBeTruthy();
    // 3 mounts × 1 gun seat each — the "3× S3" the admin asked to read.
    expect(kid?.querySelector('.size-tag')?.textContent?.trim()).toBe('3× S3');
    // Nothing resolvable in the seat → an explicit placeholder, not a dropped row.
    expect(kid?.querySelector('.kid-empty')?.textContent?.trim()).toBe('—');
    expect(kid?.querySelector('.meta-txt')?.textContent?.trim()).toBe('Weapon Gun');
  });

  it('marks a row as locatable only when its port has a hull position', () => {
    const located = { ...PANTHER, rawPort: 'hardpoint_weapon_top_left' };
    const unknown = slot({ port: 'Hardpoint Weapon Bottom', rawPort: 'hardpoint_weapon_bottom' });
    fixture.componentRef.setInput('locatablePorts', ['hardpoint_weapon_top_left']);
    const el = render([{ section: 'weapons', slots: [located, unknown] }]);
    const rows = Array.from(el.querySelectorAll('.slot'));
    expect(rows[0].classList).toContain('located');
    expect(rows[1].classList).not.toContain('located');
  });

  it('emits the raw port names of a hovered row, and null on leave', () => {
    const seen: (string[] | null)[] = [];
    fixture.componentInstance.hovered.subscribe((v) => seen.push(v));
    const el = render([
      {
        section: 'weapons',
        slots: [
          { ...PANTHER, rawPort: 'hardpoint_weapon_top_left' },
          { ...PANTHER, rawPort: 'hardpoint_weapon_top_right' },
        ],
      },
    ]);
    const row = el.querySelector('.slot') as HTMLElement;
    row.dispatchEvent(new MouseEvent('mouseenter'));
    row.dispatchEvent(new MouseEvent('mouseleave'));
    // The two identical mounts collapse into ONE row standing for both ports.
    expect(seen).toEqual([['hardpoint_weapon_top_left', 'hardpoint_weapon_top_right'], null]);
  });

  it('emits null for a row whose port name the extract never carried', () => {
    const seen: (string[] | null)[] = [];
    fixture.componentInstance.hovered.subscribe((v) => seen.push(v));
    const el = render([{ section: 'weapons', slots: [PANTHER] }]); // no rawPort
    (el.querySelector('.slot') as HTMLElement).dispatchEvent(new MouseEvent('mouseenter'));
    expect(seen).toEqual([null]);
  });

  it('highlights the row the hull map points at', () => {
    fixture.componentRef.setInput('activePorts', ['hardpoint_weapon_top_left']);
    const el = render([
      {
        section: 'weapons',
        slots: [
          { ...PANTHER, rawPort: 'hardpoint_weapon_top_left' },
          slot({ port: 'Hardpoint Weapon Bottom', rawPort: 'hardpoint_weapon_bottom' }),
        ],
      },
    ]);
    const rows = Array.from(el.querySelectorAll('.slot'));
    expect(rows[0].classList).toContain('on');
    expect(rows[1].classList).not.toContain('on');
  });

  it('says so when a real gun has no numbers in this extract', () => {
    const el = render([
      {
        section: 'weapons',
        slots: [{ ...PANTHER, stats: [], statsMissing: true }],
      },
    ]);
    expect(el.querySelector('.slot-note')).toBeTruthy();
    expect(el.querySelector('.slot-stats')).toBeNull();
  });

  it('orders the configurable blocks first and de-emphasises the fixed rest', () => {
    const el = render([
      { section: 'structure', slots: [slot({ port: 'Hardpoint Thruster', className: 'T', kind: 'component', name: 'T' })] },
      { section: 'lifeSupport', slots: [slot({ port: 'Hardpoint Life Support', className: 'L', kind: 'item', name: 'L' })] },
      { section: 'weapons', slots: [PANTHER] },
    ]);
    const order = Array.from(el.querySelectorAll('.mod-sec')).map((s) =>
      s.getAttribute('data-sec'),
    );
    expect(order).toEqual(['weapons', 'lifeSupport', 'structure']);
    const fixed = el.querySelector('.mod-sec[data-sec="structure"]');
    expect(fixed?.classList).toContain('fixed');
  });

  it('opens the swap picker when a CONFIGURABLE module is clicked', () => {
    const swaps: LayoutTarget[] = [];
    const inspects: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    fixture.componentInstance.inspected.subscribe((v) => inspects.push(v));
    const el = render([{ section: 'weapons', slots: [PANTHER, { ...PANTHER, port: 'B' }] }]);
    (el.querySelector('button.slot-btn') as HTMLButtonElement).click();
    expect(inspects.length).toBe(0);
    expect(swaps.length).toBe(1);
    expect(swaps[0].slot.className).toBe('KLWE_LaserRepeater_S3');
    expect(swaps[0].count).toBe(2); // the collapsed row stands for both mounts
    expect(swaps[0].child).toBeNull();
  });

  it('falls back to the stat sheet for a block that cannot be configured', () => {
    const swaps: LayoutTarget[] = [];
    const inspects: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    fixture.componentInstance.inspected.subscribe((v) => inspects.push(v));
    const thruster = slot({
      port: 'Hardpoint Thruster',
      className: 'T',
      kind: 'component',
      name: 'T',
    });
    const el = renderUnfolded([{ section: 'structure', slots: [thruster] }]);
    (el.querySelector('button.slot-btn') as HTMLButtonElement).click();
    expect(swaps.length).toBe(0);
    expect(inspects.length).toBe(1);
    // Nothing to swap here, so the row carries no side button either.
    expect(el.querySelector('.slot-swap')).toBeNull();
  });

  it('keeps the full stat sheet reachable from a configurable row', () => {
    const inspects: LayoutTarget[] = [];
    fixture.componentInstance.inspected.subscribe((v) => inspects.push(v));
    const el = render([{ section: 'weapons', slots: [PANTHER] }]);
    (el.querySelector('.slot-swap') as HTMLButtonElement).click();
    expect(inspects.length).toBe(1);
    expect(inspects[0].slot.className).toBe('KLWE_LaserRepeater_S3');
  });

  it('targets the gun INSIDE a mount when its sub-slot is clicked', () => {
    const swaps: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    const filled = {
      ...VARIPUCK,
      children: [
        child({
          port: 'Hardpoint Class 3',
          className: 'KLWE_LaserRepeater_S3',
          kind: 'weapon' as const,
          name: 'CF-337 Panther Repeater',
          size: 3,
        }),
      ],
    };
    const el = render([{ section: 'weapons', slots: [filled] }]);
    (el.querySelector('button.kid-btn') as HTMLButtonElement).click();
    expect(swaps.length).toBe(1);
    expect(swaps[0].child?.className).toBe('KLWE_LaserRepeater_S3');
  });

  it('does not open a picker for a sub-slot the extract left empty', () => {
    const swaps: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    const el = render([{ section: 'weapons', slots: [VARIPUCK] }]);
    expect(el.querySelector('button.kid-btn')).toBeNull(); // empty seat is inert
    expect(swaps.length).toBe(0);
  });

  // ── admin request 1add86a4 ────────────────────────────────────────────────

  it('says an unfitted GUN mount lacks extract data, not that the ship is unarmed', () => {
    const el = render([
      {
        section: 'weapons',
        slots: [
          slot({
            port: 'Hardpoint Weapon Bottom',
            emptyLabelKey: 'codex.detail.loadoutEmptyWeaponMount',
          }),
        ],
      },
    ]);
    // The default "empty (stock)" copy would read as "this ship has no gun".
    expect(el.querySelector('.slot-empty')?.textContent?.trim()).toBe(
      'codex.detail.loadoutEmptyWeaponMount',
    );
  });

  it('renders a block note under its heading', () => {
    const el = render([
      {
        section: 'weapons',
        slots: [PANTHER],
        notes: [{ key: 'codex.equipped.armamentMissing', params: { count: 3 } }],
      },
    ]);
    const note = el.querySelector('.mod-sec[data-sec="weapons"] .sec-note');
    expect(note?.textContent?.trim()).toBe('codex.equipped.armamentMissing');
  });

  it('keeps every shield bay on its own row, empty ones included', () => {
    const bay = (port: string, className: string | null) =>
      slot({
        port,
        className,
        kind: className ? ('component' as const) : null,
        name: className ? 'Sechs Shield' : null,
        size: className ? 1 : null,
        noCollapse: true,
        roleKey: 'codex.moduleRole.shieldGenerator',
        emptySwappable: !className,
        portSize: 1,
      });
    const el = render([
      {
        section: 'shields',
        slots: [
          bay('Hardpoint Shield Generator 01', null),
          bay('Hardpoint Shield Generator 02', 'SHLD_SECO_S01'),
          bay('Hardpoint Shield Generator 03', 'SHLD_SECO_S01'),
        ],
      },
    ]);
    // Three bays, three rows — never "2× S1" plus one empty.
    expect(el.querySelectorAll('.slot').length).toBe(3);
    expect(el.querySelectorAll('.tag.role').length).toBe(3);
  });

  it('tells the shield CONTROL module apart from a generator bay', () => {
    const el = render([
      {
        section: 'shields',
        slots: [
          slot({
            port: 'Hardpoint Controller Shield',
            className: 'Controller_Shield_CNOU_Nomad',
            kind: 'item',
            name: 'Shield Controller',
            roleKey: 'codex.moduleRole.shieldController',
          }),
        ],
      },
    ]);
    expect(el.querySelector('.tag.role')?.textContent?.trim()).toBe(
      'codex.moduleRole.shieldController',
    );
  });

  it('opens the picker for an empty bay we know the accepted type of', () => {
    const swaps: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    const el = render([
      {
        section: 'shields',
        slots: [
          slot({
            port: 'Hardpoint Shield Generator 01',
            rawPort: 'hardpoint_shield_generator_01',
            emptySwappable: true,
            portSize: 1,
          }),
        ],
      },
    ]);
    const btn = el.querySelector('button.slot-btn.open-bay') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(swaps.length).toBe(1);
    expect(swaps[0].slot.rawPort).toBe('hardpoint_shield_generator_01');
    expect(swaps[0].child).toBeNull();
  });

  it('leaves an empty bay inert when nothing says what fits in it', () => {
    const swaps: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    const el = render([
      { section: 'weapons', slots: [slot({ port: 'Hardpoint Weapon Bottom' })] },
    ]);
    expect(el.querySelector('button.slot-btn')).toBeNull();
    expect(swaps.length).toBe(0);
  });

  it('gives countermeasures a read-only block of their own, below the choices', () => {
    const rack = slot({
      port: 'Hardpoint Missiles Wing Left',
      className: 'MRCK_S04_CNOU_Quad_S02_Left',
      kind: 'weapon',
      name: 'MSD-442 Missile Rack',
      size: 4,
      typeLabel: 'Missile Rack',
      stats: [
        { labelKey: 'codex.equipped.missileCount', value: 4, format: 'int' },
        { labelKey: 'codex.equipped.missileSize', value: 2, format: 'size' },
      ],
    });
    const decoy = slot({
      port: 'Hardpoint Countermeasure Launcher Left',
      className: 'CNOU_Nomad_CML_Flare',
      kind: 'weapon',
      name: 'Decoy Launcher',
      size: 1,
      noCollapse: true,
      typeLabel: 'Countermeasure Launcher',
    });
    const el = render([
      { section: 'countermeasures', slots: [decoy] },
      { section: 'missiles', slots: [rack] },
    ]);
    const order = Array.from(el.querySelectorAll('.mod-sec')).map((s) =>
      s.getAttribute('data-sec'),
    );
    expect(order).toEqual(['missiles', 'countermeasures']);
    // The rack leads with what it CARRIES, not only with its own size.
    const rackStats = Array.from(
      el.querySelectorAll('.mod-sec[data-sec="missiles"] .slot-stats dd'),
    ).map((d) => d.textContent?.trim());
    expect(rackStats).toEqual(['4', 'S2']);
    // The launcher still opens its stat sheet — it just isn't a swap any more
    // (32659942), so the block wears the "not configurable" tag.
    const cm = el.querySelector('.mod-sec[data-sec="countermeasures"]');
    expect(cm?.querySelector('button.slot-btn')).toBeTruthy();
    expect(cm?.classList).toContain('fixed');
    expect(cm?.querySelector('.sec-tag')).toBeTruthy();
  });

  // ── "alle oder einzeln" (32659942) ────────────────────────────────────────

  const THREE_MOUNTS: LayoutSection[] = [
    {
      section: 'weapons',
      slots: [
        { ...VARIPUCK, port: 'Hardpoint Weapon Wing Left' },
        { ...VARIPUCK, port: 'Hardpoint Weapon Wing Right' },
        { ...VARIPUCK, port: 'Hardpoint Weapon Nose' },
      ],
    },
  ];

  it('offers to split a collapsed block into one row per hardpoint', () => {
    const el = render(THREE_MOUNTS);
    expect(el.querySelectorAll('.slot').length).toBe(1);

    const toggle = el.querySelector(
      '.mod-sec[data-sec="weapons"] .sec-btn',
    ) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    fixture.detectChanges();
    // Every mount is now its own decision, each naming its own position.
    expect(el.querySelectorAll('.slot').length).toBe(3);
    expect(
      Array.from(el.querySelectorAll('.duo > .slot-btn > .slot-port')).map((p) =>
        p.textContent?.trim(),
      ),
    ).toEqual([
      'Hardpoint Weapon Wing Left',
      'Hardpoint Weapon Wing Right',
      'Hardpoint Weapon Nose',
    ]);
    expect(el.querySelector('.size-tag')?.textContent?.trim()).toBe('S3');
    expect(
      (el.querySelector('.mod-sec[data-sec="weapons"] .sec-btn') as HTMLElement).getAttribute(
        'aria-expanded',
      ),
    ).toBe('true');
  });

  it('swaps a single hardpoint once the block is split, not all three at once', () => {
    const swaps: LayoutTarget[] = [];
    fixture.componentInstance.swapRequested.subscribe((v) => swaps.push(v));
    const el = render(THREE_MOUNTS);

    (el.querySelector('button.slot-btn') as HTMLButtonElement).click();
    expect(swaps[0].count).toBe(3); // collapsed: the row stands for all three

    (el.querySelector('.mod-sec[data-sec="weapons"] .sec-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelectorAll('button.slot-btn')[1] as HTMLButtonElement).click();
    expect(swaps[1].count).toBe(1);
    expect(swaps[1].slot.port).toBe('Hardpoint Weapon Wing Right');
  });

  it('offers the split only where collapsing actually hides a hardpoint', () => {
    const el = render([{ section: 'weapons', slots: [PANTHER] }]);
    expect(el.querySelector('.sec-btn')).toBeNull();
  });

  it('folds the airframe away until it is asked for', () => {
    const thruster = slot({
      port: 'Hardpoint Thruster',
      className: 'T',
      kind: 'component',
      name: 'T',
    });
    const el = render([{ section: 'weapons', slots: [PANTHER] }, { section: 'structure', slots: [thruster] }]);
    // The heading and its count stay — only the inventory is folded.
    const fixed = el.querySelector('.mod-sec[data-sec="structure"]') as HTMLElement;
    expect(fixed.querySelector('.sec-ct')?.textContent?.trim()).toBe('1');
    expect(fixed.querySelector('.sec-rows')).toBeNull();
    // A configurable block is never folded — that would hide the action.
    expect(el.querySelector('.mod-sec[data-sec="weapons"] .sec-rows')).toBeTruthy();
    expect(el.querySelector('.mod-sec[data-sec="weapons"] .sec-btn.fold')).toBeNull();

    (fixed.querySelector('.sec-btn.fold') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixed.querySelector('.sec-rows')).toBeTruthy();
  });
});
