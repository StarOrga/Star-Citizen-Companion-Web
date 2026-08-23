import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { KeybindsComponent } from './keybinds.component';
import { CodexService } from './codex.service';
import { CodexKeybind } from './codex.types';
import { RoleService } from '../auth/role.service';
import { KeybindCategoryService, keybindKey } from './keybind-category.service';
import { EMPTY_ASSIGNMENT, KeybindAssignment } from './keybind-taxonomy';

/**
 * Stand-in for the DB-backed category store: the same signal surface the
 * component reads, with `apply()` writing straight into the local map so the
 * assignment flow can be exercised without Supabase.
 */
function fakeCats(seed: Record<string, Partial<KeybindAssignment>> = {}) {
  const map = new Map<string, KeybindAssignment>(
    Object.entries(seed).map(([k, v]) => [k, { ...EMPTY_ASSIGNMENT, ...v }]),
  );
  const byAction = signal<ReadonlyMap<string, KeybindAssignment>>(map);
  return {
    byAction: byAction.asReadonly(),
    loaded: signal(true).asReadonly(),
    saving: signal(false),
    error: signal<string | null>(null),
    load: jasmine.createSpy('load').and.resolveTo(undefined),
    apply: jasmine
      .createSpy('apply')
      .and.callFake(
        async (targets: { actionmap: string; actionName: string }[], a: KeybindAssignment) => {
          const next = new Map(byAction());
          for (const t of targets) {
            const key = keybindKey(t.actionmap, t.actionName);
            if (Object.values(a).some((v) => v !== null)) next.set(key, a);
            else next.delete(key);
          }
          byAction.set(next);
          return true;
        },
      ),
  };
}

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
    /** Admin sees the assignment tooling; everyone else the plain reference. */
    admin?: boolean;
    /** Seeded category assignments, keyed `actionmap::action_name`. */
    cats?: Record<string, Partial<KeybindAssignment>>;
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
        {
          provide: RoleService,
          useValue: {
            isCollaborator: signal(false),
            isAdmin: signal(opts.admin ?? false),
          },
        },
        { provide: KeybindCategoryService, useValue: fakeCats(opts.cats) },
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
  // ── admin category assignment (feedback fd58a5eb) ────────────────────────

  it('hides the assignment tooling from non-admins', async () => {
    const fixture = await setup({ binds: SAMPLE, labels: LABELS });
    expect(fixture.nativeElement.querySelector('.assign-toggle')).toBeNull();
    // Even if the flag were flipped, `editing()` gates on the role.
    fixture.componentInstance.assignMode.set(true);
    expect(fixture.componentInstance.editing()).toBeFalse();
  });

  it('opens the assignment bar for an admin', async () => {
    const fixture = await setup({ binds: SAMPLE, labels: LABELS, admin: true });
    expect(fixture.nativeElement.querySelector('.assign-toggle')).not.toBeNull();
    fixture.componentInstance.toggleAssignMode();
    fixture.detectChanges();
    expect(fixture.componentInstance.editing()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.assign-bar')).not.toBeNull();
  });

  it('builds the hierarchy pickers as themed listboxes, not native selects', async () => {
    const fixture = await setup({ binds: SAMPLE, labels: LABELS, admin: true });
    fixture.componentInstance.toggleAssignMode();
    fixture.detectChanges();

    // A native <select> draws its open state through the OS, which is what
    // round 2 of fd58a5eb rejected — there must not be one left in the bar.
    expect(fixture.nativeElement.querySelectorAll('.assign-bar select').length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.pickers sc-select').length).toBe(5);
    const combos = fixture.nativeElement.querySelectorAll(
      '.pickers [role="combobox"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(combos.length).toBe(5);
    // L2/L3 stay disabled until their parent narrows them.
    expect(combos[1].disabled).toBeTrue();
  });

  it('cascades the pickers and forgets a child its new parent forbids', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS, admin: true })).componentInstance;
    cmp.setLayer('scope', 'verse');
    expect(cmp.environments()).toEqual(['on_foot', 'in_vehicle', 'spectator']);
    cmp.setLayer('environment', 'in_vehicle');
    cmp.setLayer('role', 'pilot');
    expect(cmp.draft().role).toBe('pilot');
    cmp.setLayer('scope', 'in_game');
    expect(cmp.draft().environment).toBeNull();
    expect(cmp.draft().role).toBeNull();
  });

  it('assigns a whole actionmap in one click', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS, admin: true })).componentInstance;
    cmp.toggleAssignMode();
    cmp.toggleGroup(cmp.groups()[0]);
    expect(cmp.selectedCount()).toBe(2);
    cmp.setLayer('actionGroup', 'flight_control');
    await cmp.applyToSelection();
    expect(cmp.cats.apply).toHaveBeenCalled();
    // Selection resets after a successful write, and the rows now carry chips.
    expect(cmp.selectedCount()).toBe(0);
    const rows = cmp.groups()[0].rows;
    expect(rows.every((r) => r.assigned)).toBeTrue();
    expect(cmp.chips(rows[0]).map((c) => c.key))
      .toEqual(['codex.keybinds.taxonomy.actionGroup.flight_control']);
    expect(cmp.assignedTotal()).toBe(2);
  });

  it('filters down to the actions still waiting for a category', async () => {
    const cmp = (
      await setup({
        binds: SAMPLE,
        labels: LABELS,
        admin: true,
        cats: { [keybindKey('ui_menu', 'ui_back')]: { actionGroup: 'interaction' } },
      })
    ).componentInstance;
    expect(cmp.assignedTotal()).toBe(1);
    cmp.setFilter('unassigned');
    expect(cmp.shownCount()).toBe(2);
    cmp.setFilter('assigned');
    expect(cmp.groups().map((g) => g.actionmap)).toEqual(['ui_menu']);
    cmp.setFilter('all');
    expect(cmp.shownCount()).toBe(3);
  });

  it('clears an assignment back to unclassified', async () => {
    const cmp = (
      await setup({
        binds: SAMPLE,
        labels: LABELS,
        admin: true,
        cats: { [keybindKey('ui_menu', 'ui_back')]: { actionGroup: 'interaction' } },
      })
    ).componentInstance;
    cmp.toggleAssignMode();
    const row = cmp.groups()[1].rows[0];
    cmp.editRow(row);
    expect(cmp.draft().actionGroup).toBe('interaction');
    await cmp.clearSelectionAssignment();
    expect(cmp.assignedTotal()).toBe(0);
  });

  it('leaves assignment mode without a lingering selection', async () => {
    const cmp = (await setup({ binds: SAMPLE, labels: LABELS, admin: true })).componentInstance;
    cmp.toggleAssignMode();
    cmp.toggleRow(cmp.groups()[0].rows[0]);
    expect(cmp.selectedCount()).toBe(1);
    cmp.toggleAssignMode();
    expect(cmp.selectedCount()).toBe(0);
    expect(cmp.filter()).toBe('all');
  });

  // ── impersonation-banner offset (profil-ansehen-als-bug) ─────────────────

  it('offsets both sticky bars by --sc-imp-banner-h so they park below the banner, not under it', async () => {
    document.documentElement.style.setProperty('--sc-imp-banner-h', '40px');
    try {
      const fixture = await setup({ binds: SAMPLE, labels: LABELS, admin: true });
      fixture.componentInstance.toggleAssignMode();
      fixture.detectChanges();

      const controls: HTMLElement = fixture.nativeElement.querySelector('.kb-controls');
      const assignBar: HTMLElement = fixture.nativeElement.querySelector('.assign-bar');
      expect(controls).not.toBeNull();
      expect(assignBar).not.toBeNull();

      // Both computed `top` values must move with the published var (40px),
      // proving they reference --sc-imp-banner-h rather than a bare offset.
      expect(getComputedStyle(controls).top).toBe('40px');
      expect(getComputedStyle(assignBar).top).toBe('100px'); // 40px banner + 60px controls
    } finally {
      document.documentElement.style.removeProperty('--sc-imp-banner-h');
    }
  });
});
