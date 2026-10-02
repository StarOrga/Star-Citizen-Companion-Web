import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { LayoutSection, LayoutSlot } from '../codex-hardpoint-layout.component';
import { CodexHoloComponentsComponent, buildHoloComponentGroups } from './codex-holo-components.component';

function slot(over: Partial<LayoutSlot>): LayoutSlot {
  return { port: 'Port', className: 'cls', kind: null, name: 'Item', size: 2, grade: null, manufacturerCode: null, ...over };
}

const SECTIONS: LayoutSection[] = [
  { section: 'quantum' as LayoutSection['section'], slots: [slot({ rawPort: 'hardpoint_qd', name: 'Atlas' })] },
  {
    section: 'weapons' as LayoutSection['section'],
    slots: [
      slot({ rawPort: 'hardpoint_gun_l', name: 'Gun L' }),
      slot({ rawPort: 'hardpoint_gun_r', name: 'Gun R' }),
      slot({ rawPort: 'hardpoint_empty', className: null, name: null }),
    ],
  },
];

describe('buildHoloComponentGroups', () => {
  it('lists installed slots only and marks which ports the model knows', () => {
    const groups = buildHoloComponentGroups(SECTIONS, new Set(['hardpoint_qd', 'hardpoint_gun_l']));
    expect(groups.map((g) => g.entries.map((e) => e.name))).toEqual([['Atlas'], ['Gun L', 'Gun R']]);
    expect(groups[1].entries[1].located).toEqual([]);
    expect(groups[0].entries[0].located).toEqual(['hardpoint_qd']);
  });

  it('collects child ports and ignores slots without any raw port', () => {
    const groups = buildHoloComponentGroups(
      [{ section: 'weapons' as LayoutSection['section'], slots: [
        slot({ rawPort: 'mount', children: [{ port: 'g', typeLabel: null, size: 1, className: 'x', kind: null, name: 'g', count: 1, rawPorts: ['mount_gun'], rawTypes: [] }] }),
        slot({ rawPort: undefined }),
      ] }],
      new Set(['mount_gun']),
    );
    expect(groups[0].entries.length).toBe(1);
    expect(groups[0].entries[0].ports).toEqual(['mount', 'mount_gun']);
    expect(groups[0].entries[0].located).toEqual(['mount_gun']);
  });
});

describe('CodexHoloComponentsComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [CodexHoloComponentsComponent], providers: [provideTranslateService({ fallbackLang: 'en' })] });
    const fixture = TestBed.createComponent(CodexHoloComponentsComponent);
    fixture.componentRef.setInput('sections', SECTIONS);
    fixture.componentRef.setInput('modelPorts', ['hardpoint_qd', 'hardpoint_gun_l']);
    const hovered: (string[] | null)[] = [];
    const pinned: string[][] = [];
    fixture.componentInstance.hovered.subscribe((v) => hovered.push(v));
    fixture.componentInstance.pinned.subscribe((v) => pinned.push(v));
    fixture.detectChanges();
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button.hc-btn'));
    return { fixture, hovered, pinned, buttons };
  }

  it('renders every entry as a button and flags an unknown position', () => {
    const { buttons } = setup();
    expect(buttons.length).toBe(3);
    const unknown = buttons[2];
    expect(unknown.classList).toContain('unknown');
    expect(unknown.getAttribute('aria-disabled')).toBe('true');
    expect(unknown.textContent).toContain('codex.holo.components.unknownPosition');
  });

  it('heads every group with its installed and located counts', () => {
    const { fixture, buttons } = setup();
    const counts = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.hc-sec-count'));
    expect(counts.length).toBeGreaterThan(0);
    const located = buttons.filter((b) => !b.classList.contains('unknown')).length;
    const component = fixture.componentInstance;
    const groups = component.groups();
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(buttons.length);
    expect(groups.reduce((n, g) => n + component.locatedCount(g), 0)).toBe(located);
    expect(counts[0].textContent).toContain('codex.holo.components.groupCount');
  });

  it('previews on hover and never highlights an unlocated entry', () => {
    const { buttons, hovered } = setup();
    buttons[0].dispatchEvent(new Event('mouseenter'));
    buttons[2].dispatchEvent(new Event('mouseenter'));
    expect(hovered).toEqual([['hardpoint_qd']]);
  });

  it('pins on click, unpins on a second click and on Escape', () => {
    const { fixture, buttons, pinned } = setup();
    buttons[1].click();
    fixture.detectChanges();
    expect(pinned.at(-1)).toEqual(['hardpoint_gun_l']);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    buttons[1].click();
    expect(pinned.at(-1)).toEqual([]);
    buttons[0].click();
    (fixture.nativeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pinned.at(-1)).toEqual([]);
    buttons[2].click();
    expect(pinned.at(-1)).toEqual([]);
  });
});
