import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, TranslationObject, provideTranslateService } from '@ngx-translate/core';
import { BlueprintDetailComponent } from './blueprint-detail.component';
import { BlueprintDetail, CodexService } from './codex.service';
import { CodexBlueprintIngredient } from './codex.types';

const MICROSAT = 'BP_CRAFT_Carryable_2H_FL_MissionItem_Microsatellite_a';

function ingredient(
  ingredientIndex: number,
  ingredientClassName: string,
  quantity: number,
  slot: Partial<Pick<CodexBlueprintIngredient, 'role' | 'minQuality'>> = {},
): CodexBlueprintIngredient {
  return {
    blueprintClassName: MICROSAT,
    ingredientIndex,
    ingredientClassName,
    quantity,
    minQuality: 0,
    role: 'primary',
    nameLocalized: null,
    entityKind: null,
    ...slot,
  };
}

/** The blueprint row as codex_blueprints holds it, with the given ingredients. */
function blueprint(ingredients: CodexBlueprintIngredient[]): BlueprintDetail {
  return {
    classNameSlug: MICROSAT,
    row: {
      class_name: MICROSAT,
      output_class_name: 'Carryable_2H_FL_MissionItem_Microsatellite_a',
      payload: { className: MICROSAT },
    },
    ingredients,
  };
}

/**
 * Render the page for `detail`. Without `translations` every key renders as
 * itself, as the pipe does before a language file arrives.
 */
async function setup(
  detail: BlueprintDetail,
  translations?: TranslationObject,
): Promise<ComponentFixture<BlueprintDetailComponent>> {
  TestBed.configureTestingModule({
    imports: [BlueprintDetailComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: CodexService, useValue: { getBlueprint: async () => detail } as Partial<CodexService> },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ className: detail.classNameSlug }) } },
      },
    ],
  });
  if (translations) {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', translations);
    translate.use('en');
  }
  const fixture = TestBed.createComponent(BlueprintDetailComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** The "× n" read-outs of every row matching `rowSelector`, in page order. */
function quantities(fixture: ComponentFixture<BlueprintDetailComponent>, rowSelector: string): string[] {
  const el: HTMLElement = fixture.nativeElement;
  return Array.from(el.querySelectorAll(`${rowSelector} .ing-qty`)).map((q) => q.textContent!.trim());
}

describe('BlueprintDetailComponent — quantities', () => {
  it('prints a stored float32 SCU amount without its noise (Microsatellite: 0.2 Aluminum + 0.2 Silicon)', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Aluminum', 0.20000000298023224),
        ingredient(1, 'Silicon', 0.20000000298023224),
      ]),
    );
    expect(quantities(fixture, '.ingredient-row')).toEqual(['× 0.2', '× 0.2']);
  });

  it('keeps the 0.015 SCU step and whole amounts as they are', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Gold', 0.014999999664723873),
        ingredient(1, 'Iron', 15),
        ingredient(2, 'Copper', 12.5),
      ]),
    );
    expect(quantities(fixture, '.ingredient-row')).toEqual(['× 0.015', '× 15', '× 12.5']);
  });

  it('prints the output count as a whole number', async () => {
    const fixture = await setup(blueprint([ingredient(0, 'Aluminum', 0.20000000298023224)]));
    expect(quantities(fixture, '.output-row')).toEqual(['× 1']);
  });
});

/** The texts of every ingredient row's `.badge.<kind>`, in page order. */
function badges(fixture: ComponentFixture<BlueprintDetailComponent>, kind: 'role' | 'quality'): string[] {
  const el: HTMLElement = fixture.nativeElement;
  return Array.from(el.querySelectorAll(`.ingredient-row .badge.${kind}`)).map((b) => b.textContent!.trim());
}

// Slots and quality floors as the current build stores them: CIG's upper-case
// slot names (some with a trailing colon) and its 0–1000 quality scale.
describe('BlueprintDetailComponent — ingredient badges', () => {
  it('reads a min quality on the 0–1000 scale, not as a fraction (CollectorMaterial_001: Titanium 900, Riccite 800)', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Titanium', 2, { role: 'SUBSTRATE', minQuality: 900 }),
        ingredient(1, 'Riccite', 2, { role: 'LATTICE', minQuality: 800 }),
      ]),
      { blueprint: { detail: { minQuality: 'Min quality' } } },
    );
    expect(badges(fixture, 'quality')).toEqual(['Min quality: 900 / 1,000', 'Min quality: 800 / 1,000']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('%');
  });

  it('shows no quality badge for a slot that takes any material (0 on FPS gear, 1 on ship parts, none)', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Iron', 0.2, { role: 'CASING', minQuality: 0 }),
        ingredient(1, 'Agricium', 0.36000001430511475, { role: 'FRAME', minQuality: 1 }),
        ingredient(2, 'Copper', 0.1, { role: 'WIRING', minQuality: null }),
      ]),
    );
    expect(badges(fixture, 'quality')).toEqual([]);
  });

  it('labels CIG slot names in readable words and never shows a raw i18n key', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Titanium', 2, { role: 'SUBSTRATE' }),
        ingredient(1, 'Aluminum', 0.2, { role: 'PROTECTIVE SHEATHING' }),
        ingredient(2, 'Iron', 0.2, { role: 'BARREL:' }),
      ]),
    );
    expect(badges(fixture, 'role')).toEqual(['Substrate', 'Protective Sheathing', 'Barrel']);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('blueprint.role.');
  });

  it('takes a slot translation when one exists and gives a row without a slot no badge', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Gold', 0.015, { role: 'secondary' }),
        ingredient(1, 'Aluminum', 0.2, { role: 'PROTECTIVE SHEATHING' }),
        ingredient(2, 'Iron', 15), // role 'primary': the service's stand-in for "no slot named"
      ]),
      { blueprint: { role: { secondary: 'Secondary', protectiveSheathing: 'Sheathing' } } },
    );
    expect(badges(fixture, 'role')).toEqual(['Secondary', 'Sheathing']);
  });
});
