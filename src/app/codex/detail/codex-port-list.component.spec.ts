import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexPortListComponent } from './codex-port-list.component';
import type { PortCompat, PortGroup } from './codex-detail.types';
import type { CodexItemPort } from '../codex.types';

function port(over: Partial<CodexItemPort> & { portIndex: number }): CodexItemPort {
  return {
    parentClassName: 'AEGS_Gladius',
    parentKind: 'ship',
    portName: `hardpoint_weapon_${over.portIndex}`,
    minSize: 3,
    maxSize: 3,
    types: ['WeaponGun'],
    flags: [],
    helperName: null,
    position: null,
    rotation: null,
    ...over,
  };
}

const GROUPS: PortGroup[] = [
  {
    category: 'weapons',
    ports: [
      port({ portIndex: 1, portName: 'hardpoint_weapon_left', minSize: 1, maxSize: 3 }),
      port({ portIndex: 2, portName: 'hardpoint_weapon_right' }),
    ],
  },
  { category: 'power', ports: [port({ portIndex: 3, portName: 'hardpoint_seat', types: [], minSize: null, maxSize: null })] },
];

describe('CodexPortListComponent', () => {
  let fixture: ComponentFixture<CodexPortListComponent>;

  async function render(inputs: Record<string, unknown> = {}): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [CodexPortListComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexPortListComponent);
    fixture.componentRef.setInput('groups', GROUPS);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders one group per category with its port count and the size range per port', async () => {
    const el = await render();
    const cats = el.querySelectorAll('.hp-cat');
    expect(cats.length).toBe(2);
    expect(cats[0].textContent).toContain('codex.portCategory.weapons');
    expect(cats[0].querySelector('.hp-ct')?.textContent).toBe('2');
    const sizes = Array.from(el.querySelectorAll('.hp-size')).map((s) => s.textContent?.trim());
    expect(sizes).toEqual(['S1–3', 'S3', '—']);
    // No hull map unless the parent asks for it.
    expect(el.querySelector('sc-ship-hardpoint-map')).toBeNull();
  });

  it('emits portToggle from a port head, and a port that accepts nothing is a disabled head', async () => {
    const el = await render();
    const toggled = jasmine.createSpy('toggle');
    fixture.componentInstance.portToggle.subscribe(toggled);
    const heads = el.querySelectorAll<HTMLButtonElement>('button.hp-head');
    heads[0].click();
    expect(toggled).toHaveBeenCalledOnceWith(GROUPS[0].ports[0]);
    expect(heads[2].disabled).toBeTrue();
  });

  it('folds an open port out into anchors for every compatible item', async () => {
    const compat = new Map<number, PortCompat>([
      [
        1,
        {
          loading: false,
          error: null,
          items: [
            {
              kind: 'weapon',
              classNameSlug: 'AMRS_LaserCannon_S3',
              nameLocalized: 'Omnisky IX Cannon',
              manufacturerCode: 'AMRS',
              size: 3,
              subType: 'Gun',
              grade: 'A',
            },
            { kind: 'weapon', classNameSlug: 'NoName_S2', nameLocalized: null, manufacturerCode: null, size: null, subType: null, grade: null },
          ],
        },
      ],
    ]);
    const el = await render({ expandedPort: 1, compat });

    expect(el.querySelectorAll('li.hp.open').length).toBe(1);
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a.compat-link'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/codex/weapon/AMRS_LaserCannon_S3',
      '/codex/weapon/NoName_S2',
    ]);
    expect(links[0].textContent?.trim()).toBe('Omnisky IX Cannon');
    // A nameless item falls back to its class name, never an empty link.
    expect(links[1].textContent?.trim()).toBe('NoName_S2');
  });

  it('shows the loading, error and empty states of an open port', async () => {
    const el = await render({
      expandedPort: 1,
      compat: new Map<number, PortCompat>([[1, { loading: true, error: null, items: [] }]]),
    });
    expect(el.querySelector('.compat .muted')?.textContent).toContain('codex.detail.compatLoading');

    fixture.componentRef.setInput('compat', new Map([[1, { loading: false, error: 'errors.generic', items: [] }]]));
    fixture.detectChanges();
    expect(el.querySelector('.compat .err-inline')?.textContent).toContain('errors.generic');

    fixture.componentRef.setInput('compat', new Map([[1, { loading: false, error: null, items: [] }]]));
    fixture.detectChanges();
    expect(el.querySelector('.compat .muted')?.textContent).toContain('codex.detail.compatNone');
  });

  it('reports a hovered port to the hull map only when its position is known', async () => {
    const el = await render({ locatablePorts: ['hardpoint_weapon_left'], activePorts: ['hardpoint_weapon_left'] });
    const hovered: (string[] | null)[] = [];
    fixture.componentInstance.hovered.subscribe((v) => hovered.push(v));
    const items = el.querySelectorAll<HTMLElement>('li.hp');

    expect(items[0].classList).toContain('located');
    expect(items[0].classList).toContain('on');
    expect(items[1].classList).not.toContain('located');

    items[0].dispatchEvent(new Event('mouseenter'));
    items[1].dispatchEvent(new Event('mouseenter'));
    items[0].dispatchEvent(new Event('mouseleave'));
    expect(hovered).toEqual([['hardpoint_weapon_left'], null, null]);
  });
});
