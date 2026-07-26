import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { KeybindsComponent } from './keybinds.component';
import { CodexService } from './codex.service';
import { CodexKeybind } from './codex.types';
import { RoleService } from '../auth/role.service';

function bind(
  over: Partial<CodexKeybind> & { actionmap: string; actionName: string },
): CodexKeybind {
  return {
    labelKey: null,
    descriptionKey: null,
    categoryLabelKey: null,
    activationMode: null,
    bindings: { keyboard: null, mouse: null, gamepad: null, joystick: null },
    sort: 0,
    ...over,
  };
}

const SAMPLE: CodexKeybind[] = [
  bind({
    actionmap: 'spaceship_movement', actionName: 'v_strafe_up',
    labelKey: '@ui_strafe_up', categoryLabelKey: '@ui_flight',
    bindings: { keyboard: 'space', mouse: null, gamepad: 'pad_a', joystick: null }, sort: 0,
  }),
  bind({
    actionmap: 'spaceship_movement', actionName: 'v_strafe_down',
    labelKey: '@ui_strafe_down', categoryLabelKey: '@ui_flight',
    bindings: { keyboard: 'x', mouse: null, gamepad: null, joystick: null }, sort: 1,
  }),
  bind({
    actionmap: 'ui_menu', actionName: 'ui_back',
    labelKey: '@ui_back', categoryLabelKey: '@ui_menu',
    bindings: { keyboard: 'esc', mouse: null, gamepad: null, joystick: null }, sort: 2,
  }),
];

const LABELS = new Map<string, string>([
  ['@ui_strafe_up', 'Strafe Up'],
  ['@ui_strafe_down', 'Strafe Down'],
  ['@ui_flight', 'Flight – Movement'],
  ['@ui_back', 'Back'],
  ['@ui_menu', 'Menus'],
]);

describe('KeybindsComponent', () => {
  async function setup(opts: {
    binds: CodexKeybind[];
    labels?: Map<string, string>;
    /** English originals, when they differ from the active-language map. */
    labelsEn?: Map<string, string>;
    /** Active UI language — 'de' exercises the English-original fallback. */
    lang?: string;
  }) {
    const empty = new Map<string, string>();
    const codex: Partial<CodexService> = {
      build: signal({ patchVersion: '4.2', buildNumber: '9000000' }) as never,
      stale: signal(false) as never,
      latestLivePatch: signal(null) as never,
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      listKeybinds: jasmine.createSpy('listKeybinds').and.resolveTo(opts.binds),
      resolveLocaleKeys: jasmine
        .createSpy('resolveLocaleKeys')
        .and.callFake((_keys: string[], lang: string) =>
          Promise.resolve(
            lang === 'en' ? (opts.labelsEn ?? opts.labels ?? empty) : (opts.labels ?? empty),
          ),
        ),
    };

    await TestBed.configureTestingModule({
      imports: [KeybindsComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
      ],
    }).compileComponents();

    if (opts.lang) TestBed.inject(TranslateService).use(opts.lang);

    const fixture: ComponentFixture<KeybindsComponent> = TestBed.createComponent(KeybindsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('groups actions by actionmap in document order with resolved labels', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS })).componentInstance;
    expect(cmp.total()).toBe(3);
    const groups = cmp.groups();
    expect(groups.map((g) => g.actionmap)).toEqual(['spaceship_movement', 'ui_menu']);
    expect(groups[0].category).toBe('Flight – Movement');
    expect(groups[0].rows.map((r) => r.label)).toEqual(['Strafe Up', 'Strafe Down']);
  });

  it('shows the selected device binding (keyboard default → gamepad)', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS })).componentInstance;
    expect(cmp.groups()[0].rows[0].binding).toBe('space');
    cmp.setDevice('gamepad');
    expect(cmp.device()).toBe('gamepad');
    const rows = cmp.groups()[0].rows;
    expect(rows[0].binding).toBe('pad_a');
    expect(rows[1].binding).toBeNull(); // unbound on gamepad, still listed
  });

  it('filters by search over label / action / binding', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS })).componentInstance;
    cmp.onSearch('down');
    expect(cmp.shownCount()).toBe(1);
    expect(cmp.groups()[0].rows[0].label).toBe('Strafe Down');
    cmp.onSearch('nomatch-xyz');
    expect(cmp.groups().length).toBe(0);
  });

  it('derives a clean name when the label key resolves in no language', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: new Map() })).componentInstance;
    const row = cmp.groups()[0].rows[0];
    // Prefix stripped, title-cased — not the raw "v strafe up".
    expect(row.label).toBe('Strafe Up');
    expect(row.source).toBe('derived');
    expect(row.context).toBe('vehicle');
  });

  it('falls back to the English original before deriving', async () => {
    const cmp = (
      await setup({ binds: SAMPLE, labels: new Map(), labelsEn: LABELS, lang: 'de' })
    ).componentInstance;
    const row = cmp.groups()[0].rows[0];
    expect(row.label).toBe('Strafe Up');
    expect(row.source).toBe('english');
  });

  it('hoists a context shared by every row onto the group header', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS })).componentInstance;
    expect(cmp.groups()[0].context).toBe('vehicle');
    expect(cmp.groups()[1].context).toBe('interface');
  });

  it('shows the raw programmatic key under every derived label', async () => {
    const fixture = await setup({ binds: SAMPLE, labels: new Map() });
    const raws: string[] = Array.from(
      fixture.nativeElement.querySelectorAll('.act-raw') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent!.trim());
    expect(raws).toEqual(['v_strafe_up', 'v_strafe_down', 'ui_back']);
  });

  it('hides the raw key line for localized labels but keeps it in the tooltip', async () => {
    const fixture = await setup({ binds: SAMPLE, labels: LABELS });
    expect(fixture.nativeElement.querySelectorAll('.act-raw').length).toBe(0);
    const cmp = fixture.componentInstance;
    expect(cmp.rowTitle(cmp.groups()[0].rows[0])).toContain('v_strafe_up');
  });

  it('still finds a row by its raw programmatic key', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS })).componentInstance;
    cmp.onSearch('v_strafe_down');
    expect(cmp.shownCount()).toBe(1);
    expect(cmp.groups()[0].rows[0].label).toBe('Strafe Down');
  });

  it('renders the empty state when no keybinds are published', async () => {
    const fixture = await setup({ binds: [] });
    expect(fixture.componentInstance.total()).toBe(0);
    expect(fixture.nativeElement.querySelector('.empty')).not.toBeNull();
  });
});
