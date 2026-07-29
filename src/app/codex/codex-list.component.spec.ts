import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexListComponent } from './codex-list.component';
import { CodexListRow, CodexService } from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { RoleService } from '../auth/role.service';

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
    opts: { categories?: string[]; rows?: CodexListRow[] } = {},
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
      previewUrl: () => null,
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
});
