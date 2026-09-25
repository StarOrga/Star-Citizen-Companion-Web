import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BlueprintDetailComponent } from './blueprint-detail.component';
import { BlueprintDetail, CodexService } from './codex.service';
import { CodexBlueprintIngredient } from './codex.types';

const MICROSAT = 'BP_CRAFT_Carryable_2H_FL_MissionItem_Microsatellite_a';

function ingredient(
  ingredientIndex: number,
  ingredientClassName: string,
  quantity: number,
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

async function setup(detail: BlueprintDetail): Promise<ComponentFixture<BlueprintDetailComponent>> {
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
