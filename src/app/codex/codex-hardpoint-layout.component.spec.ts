import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import {
  CodexHardpointLayoutComponent,
  LayoutGroup,
  LayoutSlot,
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

describe('CodexHardpointLayoutComponent', () => {
  let fixture: ComponentFixture<CodexHardpointLayoutComponent>;

  function render(groups: LayoutGroup[]): HTMLElement {
    fixture.componentRef.setInput('groups', groups);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexHardpointLayoutComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexHardpointLayoutComponent);
  });

  it('leads with the mounted weapon, not with the port name', () => {
    const el = render([{ category: 'weapons', slots: [PANTHER] }]);
    expect(el.querySelector('.slot-item')?.textContent?.trim()).toBe('CF-337 Panther Repeater');
    expect(el.querySelector('.size-tag')?.textContent?.trim()).toBe('S3');
    expect(el.querySelector('.slot-port')?.textContent?.trim()).toBe('Hardpoint Weapon Top Left');
  });

  it('shows who made it and what it is on one meta line', () => {
    const el = render([{ category: 'weapons', slots: [PANTHER] }]);
    expect(el.querySelector('.meta-txt')?.textContent?.trim()).toBe('KLA · Gun');
    expect(el.querySelector('.tag.dmg')).toBeTruthy(); // the ENERGY badge
  });

  it('renders every curated stat with its unit', () => {
    const el = render([{ category: 'weapons', slots: [PANTHER] }]);
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
        category: 'weapons',
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
    const el = render([{ category: 'systems', slots: [bare] }]);
    expect(el.querySelector('.meta-txt')).toBeNull();
    expect(el.querySelector('.tag')).toBeNull();
    expect(el.querySelector('.slot-item')?.textContent?.trim()).toBe('X');
  });

  it('marks a stock-empty mount as empty instead of inventing an occupant', () => {
    const el = render([{ category: 'weapons', slots: [slot({ port: 'Hardpoint Weapon Bottom' })] }]);
    expect(el.querySelector('.slot')?.classList).toContain('empty');
    expect(el.querySelector('.slot-empty')).toBeTruthy();
    expect(el.querySelector('.slot-item')).toBeNull();
  });

  it('marks a row as locatable only when its port has a hull position', () => {
    const located = { ...PANTHER, rawPort: 'hardpoint_weapon_top_left' };
    const unknown = slot({ port: 'Hardpoint Weapon Bottom', rawPort: 'hardpoint_weapon_bottom' });
    fixture.componentRef.setInput('locatablePorts', ['hardpoint_weapon_top_left']);
    const el = render([{ category: 'weapons', slots: [located, unknown] }]);
    const rows = Array.from(el.querySelectorAll('.slot'));
    expect(rows[0].classList).toContain('located');
    expect(rows[1].classList).not.toContain('located');
  });

  it('emits the raw port names of a hovered row, and null on leave', () => {
    const seen: (string[] | null)[] = [];
    fixture.componentInstance.hovered.subscribe((v) => seen.push(v));
    const el = render([
      {
        category: 'weapons',
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
    const el = render([{ category: 'weapons', slots: [PANTHER] }]); // no rawPort
    (el.querySelector('.slot') as HTMLElement).dispatchEvent(new MouseEvent('mouseenter'));
    expect(seen).toEqual([null]);
  });

  it('highlights the row the hull map points at', () => {
    fixture.componentRef.setInput('activePorts', ['hardpoint_weapon_top_left']);
    const el = render([
      {
        category: 'weapons',
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
        category: 'weapons',
        slots: [{ ...PANTHER, stats: [], statsMissing: true }],
      },
    ]);
    expect(el.querySelector('.slot-note')).toBeTruthy();
    expect(el.querySelector('.slot-stats')).toBeNull();
  });
});
