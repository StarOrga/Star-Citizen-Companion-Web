import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexListComponent } from './codex-list.component';
import { CodexListRow, CodexService } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { RoleService } from '../auth/role.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { WeaponFacetRow } from './codex-weapon-taxonomy';

function blueprintRow(className: string, category: string | null): CodexListRow {
  return {
    classNameSlug: className,
    nameLocalized: className,
    manufacturerCode: null,
    size: null,
    grade: null,
    role: null,
    crewSize: null,
    weaponClass: null,
    componentKind: null,
    subType: null,
    attachType: null,
    speed: null,
    isVariant: false,
    payload: {},
    blueprintCategory: category,
    blueprintTier: 1,
    craftTimeSec: 200,
  };
}

describe('CodexListComponent (Index mode)', () => {
  async function setup(
    entityCounts: Record<string, number>,
    opts: {
      categories?: string[];
      rows?: CodexListRow[];
      art?: string[];
      preview?: string | null;
      weaponFacets?: WeaponFacetRow[];
    } = {},
  ): Promise<{
    fixture: ComponentFixture<CodexListComponent>;
    cmp: CodexListComponent;
    listByKind: jasmine.Spy;
  }> {
    const listByKind = jasmine
      .createSpy('listByKind')
      .and.resolveTo({ rows: opts.rows ?? [], count: (opts.rows ?? []).length });

    const codex: Partial<CodexService> = {
      build: signal({ id: 'b1', entityCounts }) as never,
      stale: signal(false) as never,
      latestLivePatch: signal(null) as never,
      buildLoading: signal(false) as never,
      buildError: signal(null) as never,
      compareKeys: signal<string[]>([]).asReadonly(),
      compareCount: signal(0) as never,
      compareRejectedKind: signal(null) as never,
      loadCurrentBuild: jasmine.createSpy('loadCurrentBuild').and.resolveTo(null),
      listByKind,
      blueprintCategories: jasmine
        .createSpy('blueprintCategories')
        .and.resolveTo(opts.categories ?? []),
      isPinned: () => false,
      previewUrl: () => opts.preview ?? null,
      weaponFacets: jasmine
        .createSpy('weaponFacets')
        .and.resolveTo(opts.weaponFacets ?? []),
    };

    const hangar: Partial<HangarService> = {
      ships: signal([]) as never,
      loadAll: jasmine.createSpy('loadAll').and.resolveTo(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [CodexListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: CodexService, useValue: codex },
        { provide: HangarService, useValue: hangar },
        // The embedded status banner injects the real RoleService otherwise,
        // which pulls Auth/Supabase and hangs whenStable.
        { provide: RoleService, useValue: { isCollaborator: signal(false) } },
        // The RSI ship-matrix feed backs the "upcoming" category and the
        // artwork fallback on ship cards; the real one injects HttpClient.
        {
          provide: UpcomingShipsService,
          useValue: {
            feed: signal(null),
            loading: signal(false),
            error: signal(null),
            concept: signal([]),
            flightReadyMissing: signal([]),
            query: signal(''),
            favoritesOnly: signal(false),
            favoriteCount: signal(0),
            newIds: signal(new Set<string>()),
            ensureLoaded: jasmine.createSpy('ensureLoaded').and.resolveTo(undefined),
            refresh: jasmine.createSpy('refresh').and.resolveTo(undefined),
            acknowledge: () => undefined,
            isFavorite: () => false,
            artFor: () => opts.art ?? ([] as string[]),
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CodexListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, cmp: fixture.componentInstance, listByKind };
  }

  it('offers the blueprint kind once the build actually carries blueprints', async () => {
    // Regression: `blueprint` was hardcoded as "coming soon", so 1595 ingested
    // blueprints were unreachable from Index mode — the tab was disabled and
    // setKind() refused to switch to it.
    const { cmp } = await setup({ ships: 300, blueprints: 1595, blueprint_ingredients: 4800 });

    expect(cmp.isComingSoon('blueprint')).toBe(false);
    cmp.setKind('blueprint');
    expect(cmp.kind()).toBe('blueprint');
  });

  it('still disables a kind the build reports as empty', async () => {
    const { cmp } = await setup({ ships: 300, blueprints: 0 });

    expect(cmp.isComingSoon('blueprint')).toBe(true);
    cmp.setKind('blueprint');
    expect(cmp.kind()).toBe('ship');
  });

  it('keeps kinds enabled while the build counts are unknown', async () => {
    const { cmp } = await setup({ ships: 300 });

    expect(cmp.isComingSoon('blueprint')).toBe(false);
  });

  it('flags a build whose blueprints have no recipe rows at all', async () => {
    const { cmp } = await setup({ blueprints: 1595, blueprint_ingredients: 0 });
    cmp.setKind('blueprint');

    expect(cmp.blueprintRecipesMissing()).toBe(true);
  });

  it('does not flag a build whose recipes are present', async () => {
    const { cmp } = await setup({ blueprints: 1595, blueprint_ingredients: 4800 });
    cmp.setKind('blueprint');

    expect(cmp.blueprintRecipesMissing()).toBe(false);
  });

  it('loads the category facet from the build, not from a hardcoded list', async () => {
    const { cmp } = await setup(
      { blueprints: 1595, blueprint_ingredients: 4800 },
      { categories: ['FPSArmours', 'FPSWeapons'] },
    );

    expect(cmp.blueprintCategoryOptions()).toEqual(['FPSArmours', 'FPSWeapons']);
    // No i18n entry for a CIG class name → humanized, never the raw key.
    expect(cmp.categoryLabel('FPSArmours')).toBe('FPS Armours');
  });

  it('passes the selected blueprint category down to the query', async () => {
    const { fixture, cmp, listByKind } = await setup(
      { blueprints: 1595, blueprint_ingredients: 4800 },
      { categories: ['FPSArmours'], rows: [blueprintRow('BP_CRAFT_helmet', 'FPSArmours')] },
    );

    cmp.setKind('blueprint');
    cmp.setBlueprintCategory('FPSArmours');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listByKind).toHaveBeenCalledWith(
      'blueprint',
      jasmine.objectContaining({ category: 'FPSArmours' }),
    );
  });

  /**
   * The AN BORD / IM HANGAR archive quick-access links (prio 3/4) preset
   * `?group=fps|vehicle` to pre-filter the blueprint index without forcing a
   * single category — "Baupläne" from the board lands on every FPS bucket,
   * from the hangar on every vehicle bucket, and "Alle" still widens back out.
   */
  it('folds the blueprint group into blueprintCategoryIn, distinct from a single category', async () => {
    const { fixture, cmp, listByKind } = await setup(
      { blueprints: 1595, blueprint_ingredients: 4800 },
      { categories: ['FPSArmours', 'FPSWeapons', 'VehicleComponentS1'] },
    );

    cmp.setKind('blueprint');
    cmp.setBlueprintGroup('fps');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listByKind).toHaveBeenCalledWith(
      'blueprint',
      jasmine.objectContaining({ blueprintCategoryIn: ['FPSArmours', 'FPSWeapons'] }),
    );

    listByKind.calls.reset();
    cmp.setBlueprintGroup('');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(listByKind).toHaveBeenCalledWith(
      'blueprint',
      jasmine.objectContaining({ blueprintCategoryIn: undefined }),
    );
  });

  /**
   * The weapons category holds BOTH the on-foot catalog and every ship mount
   * (admin feedback 7897bcb0), so it browses through a two-level rail instead
   * of the old flat weapon-class dropdown.
   */
  describe('CodexListComponent — weapon super categories', () => {
    const facets: WeaponFacetRow[] = [
      { weaponClass: 'FPS', attachType: 'WeaponPersonal', subType: 'Small', isVariant: false },
      { weaponClass: 'FPS', attachType: 'WeaponPersonal', subType: 'Medium', isVariant: false },
      { weaponClass: 'Ship', attachType: 'Turret', subType: 'GunTurret', isVariant: false },
      { weaponClass: 'Ship', attachType: 'WeaponGun', subType: 'Gun', isVariant: true },
    ];

    it('shows the rail only on the weapon category', async () => {
      const { cmp } = await setup({ ships: 300, weapons: 1312 }, { weaponFacets: facets });

      expect(cmp.showsWeaponGroups()).toBe(false);
      cmp.setKind('weapon');
      expect(cmp.showsWeaponGroups()).toBe(true);
    });

    it('keeps the second level hidden until a super category is picked', async () => {
      const { fixture, cmp } = await setup({ weapons: 1312 }, { weaponFacets: facets });
      cmp.setKind('weapon');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(cmp.activeWeaponSubGroups()).toBeNull();
      cmp.setWeaponGroup('fps');
      expect(cmp.activeWeaponSubGroups()?.map((g) => g.id)).toEqual(['sidearm', 'primary']);
    });

    it('badges each category with the record count the build actually holds', async () => {
      const { fixture, cmp } = await setup({ weapons: 1312 }, { weaponFacets: facets });
      cmp.setKind('weapon');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(cmp.weaponGroupCount('fps')).toBe(2);
      // The variant-only ship gun is excluded while "include variants" is off.
      expect(cmp.weaponGroupCount('ship')).toBe(1);
      cmp.setIncludeVariants(true);
      expect(cmp.weaponGroupCount('ship')).toBe(2);
      expect(cmp.weaponGroupCount('ship', 'gun')).toBe(1);
    });

    it('narrows the SERVER query, not just the loaded page', async () => {
      const { fixture, cmp, listByKind } = await setup({ weapons: 1312 }, { weaponFacets: facets });
      cmp.setKind('weapon');
      cmp.setWeaponGroup('ship');
      cmp.setWeaponSubGroup('turret');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(listByKind).toHaveBeenCalledWith(
        'weapon',
        jasmine.objectContaining({ weaponClass: 'Ship', attachTypeIn: ['Turret'] }),
      );
    });

    it('drops the sub category when the super category changes', async () => {
      const { cmp } = await setup({ weapons: 1312 }, { weaponFacets: facets });
      cmp.setKind('weapon');
      cmp.setWeaponGroup('ship');
      cmp.setWeaponSubGroup('turret');
      cmp.setWeaponGroup('fps');

      expect(cmp.weaponSubGroup()).toBe('');
    });

    it('leaves the weapon filters behind when the reader switches kind', async () => {
      const { cmp } = await setup({ ships: 300, weapons: 1312 }, { weaponFacets: facets });
      cmp.setKind('weapon');
      cmp.setWeaponGroup('fps');
      cmp.setKind('ship');

      expect(cmp.weaponGroup()).toBe('');
      expect(cmp.hasActiveFilters()).toBe(false);
    });
  });

  /**
   * "Kommende Schiffe" is a CATEGORY of the Codex index, not a sub-tab of its own
   * (admin feedback 0a5988d5). It sits in the same strip as the datamined kinds
   * but is fed by the RSI ship-matrix, so no build manifest can disable it.
   */
  describe('CodexListComponent — upcoming category', () => {
    it('lists upcoming alongside the datamined kinds', async () => {
      const { cmp } = await setup({ ships: 300 });

      expect(cmp.categories).toContain('upcoming');
      expect(cmp.categories.slice(0, -1)).toEqual([...cmp.kinds]);
    });

    it('is never disabled, even when the build reports nothing', async () => {
      const { cmp } = await setup({});

      expect(cmp.isComingSoon('upcoming')).toBe(false);
    });

    it('swaps the facet list for the upcoming grid without disturbing the kind', async () => {
      const { cmp } = await setup({ ships: 300 });
      cmp.setKind('weapon');

      cmp.setCategory('upcoming');

      expect(cmp.isUpcoming()).toBe(true);
      // The data kind is untouched, so returning to it keeps facets + results.
      expect(cmp.kind()).toBe('weapon');
    });

    it('returns to a data kind from the upcoming category', async () => {
      const { cmp } = await setup({ ships: 300 });
      cmp.setCategory('upcoming');

      cmp.setCategory('ship');

      expect(cmp.isUpcoming()).toBe(false);
      expect(cmp.kind()).toBe('ship');
    });

    it('does not query the catalog for the upcoming category', async () => {
      const { fixture, cmp, listByKind } = await setup({ ships: 300 });
      listByKind.calls.reset();

      cmp.setCategory('upcoming');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(listByKind).not.toHaveBeenCalled();
    });
  });

  /**
   * Ship cards borrow RSI's store render when our datamined preview is absent —
   * only ~6% of the catalog ships one (feedback 0a5988d5, ask 2).
   */
  describe('CodexListComponent — ship card artwork', () => {
    const row = (): CodexListRow => ({
      ...blueprintRow('RSI_Ursa', null),
      nameLocalized: 'Ursa',
    });

    it('falls back to RSI artwork when there is no datamined render', async () => {
      const { cmp } = await setup({ ships: 300 }, { art: ['https://media.rsi/ursa.jpg'] });

      expect(cmp.thumbs(row())).toEqual(['https://media.rsi/ursa.jpg']);
    });

    it('leads with the RSI render and keeps the datamined silhouette as fallback', async () => {
      // The datamined "preview" is the game's flat white UI silhouette, so a
      // real RSI photo goes first and the silhouette only covers hulls RSI has
      // no matrix entry for (feedback 0a5988d5, ask 2).
      const { cmp } = await setup(
        { ships: 300 },
        { art: ['https://media.rsi/ursa.jpg'], preview: 'https://sb/preview.webp' },
      );

      expect(cmp.thumbs(row())).toEqual(['https://media.rsi/ursa.jpg', 'https://sb/preview.webp']);
    });

    it('does not borrow ship artwork for non-ship kinds', async () => {
      const { cmp } = await setup({ ships: 300, weapons: 40 }, { art: ['https://media.rsi/ursa.jpg'] });
      cmp.setKind('weapon');

      expect(cmp.thumbs(row())).toEqual([]);
    });
  });
  /**
   * Ships arrive one record per game FILE, so a hull shows up several times
   * over — seven `Drake Cutlass Black` records, plus marketing editions
   * ("Wikelo War Special", "2949 Best In Show Edition"). Admin feedback
   * 77ecad2a: one card per hull, editions behind a picker in the entry.
   */
  describe('CodexListComponent — ship editions', () => {
    function shipRow(
      className: string,
      name: string,
      facets: Partial<CodexListRow> = {},
    ): CodexListRow {
      return {
        ...blueprintRow(className, null),
        nameLocalized: name,
        manufacturerCode: 'AEG',
        blueprintTier: null,
        craftTimeSec: null,
        ...facets,
      };
    }

    // Facets as build 4.9.0 carries them: `_GS` reads the same name but a
    // different crew, which is exactly why the variant fold cannot take it.
    const family = [
      shipRow('AEGS_Hammerhead', 'Aegis Hammerhead', { crewSize: 9 }),
      shipRow('AEGS_Hammerhead_GS', 'Aegis Hammerhead', { crewSize: 8 }),
      shipRow('AEGS_Hammerhead_Showdown', 'Aegis Hammerhead 2949 Best In Show Edition', {
        crewSize: 9,
      }),
      shipRow('MISC_Freelancer', 'MISC Freelancer', { manufacturerCode: 'MIS', crewSize: 4 }),
      shipRow('MISC_Freelancer_MAX', 'MISC Freelancer MAX', {
        manufacturerCode: 'MIS',
        crewSize: 4,
      }),
    ];

    it('renders one card per hull and keeps different models apart', async () => {
      const { cmp } = await setup({ ships: 300 }, { rows: family });

      expect(cmp.rows().map((r) => r.classNameSlug)).toEqual([
        'AEGS_Hammerhead',
        'MISC_Freelancer',
        'MISC_Freelancer_MAX',
      ]);
      expect(cmp.editionNames(cmp.rows()[0])).toBe('2949 Best In Show Edition, GS');
      expect(cmp.rows()[1].editions).toEqual([]);
    });

    it('subtracts the absorbed records from the result count', async () => {
      const { cmp } = await setup({ ships: 300 }, { rows: family });

      expect(cmp.total()).toBe(3);
    });

    it('"include variants" shows the raw records again', async () => {
      const { fixture, cmp } = await setup({ ships: 300 }, { rows: family });
      cmp.includeVariants.set(true);
      fixture.detectChanges();

      expect(cmp.rows().length).toBe(family.length);
      expect(cmp.rows().every((r) => r.editions.length === 0)).toBeTrue();
    });

    it('never groups a non-ship kind by class-name lineage', async () => {
      // `GMNI_pistol` / `GMNI_pistol_gold01` would pass the ship rule; weapons
      // group by their quoted livery token instead (codex-skin-group).
      const { fixture, cmp } = await setup(
        { ships: 300, weapons: 40 },
        {
          rows: [
            shipRow('GMNI_pistol', 'LH86 Pistol'),
            shipRow('GMNI_pistol_gold01', 'LH86 Pistol Executive Edition'),
          ],
        },
      );
      cmp.setKind('weapon');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(cmp.rows().length).toBe(2);
      expect(cmp.rows().every((r) => r.editions.length === 0)).toBeTrue();
    });
  });
});
