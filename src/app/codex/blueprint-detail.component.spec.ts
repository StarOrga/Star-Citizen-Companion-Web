import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, TranslationObject, provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
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
function blueprint(ingredients: CodexBlueprintIngredient[], className = MICROSAT): BlueprintDetail {
  return {
    classNameSlug: className,
    row: {
      class_name: className,
      output_class_name: 'Carryable_2H_FL_MissionItem_Microsatellite_a',
      payload: { className },
    },
    ingredients,
  };
}

/**
 * Render the page for `detail`. Without `translations` every key renders as
 * itself, as the pipe does before a language file arrives. `getBlueprint`
 * stands in for the service when the page is to move on to other blueprints.
 */
async function setup(
  detail: BlueprintDetail,
  translations?: TranslationObject,
  getBlueprint: CodexService['getBlueprint'] = async () => detail,
): Promise<ComponentFixture<BlueprintDetailComponent>> {
  TestBed.configureTestingModule({
    imports: [BlueprintDetailComponent],
    providers: [
      provideTranslateService(),
      provideRouter([]),
      { provide: CodexService, useValue: { getBlueprint } as Partial<CodexService> },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: new BehaviorSubject(convertToParamMap({ className: detail.classNameSlug })) },
      },
    ],
  });
  if (translations) {
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', translations);
    translate.use('en');
  }
  const fixture = TestBed.createComponent(BlueprintDetailComponent);
  await settle(fixture);
  return fixture;
}

/** Let the page take in what just happened — pushed params, a service answer — and repaint. */
async function settle(fixture: ComponentFixture<BlueprintDetailComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
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

const COLLECTOR = 'BP_CRAFT_Carryable_2H_CY_CollectorMaterial_001';
const LASER_CANNON = 'BP_CRAFT_AMRS_LaserCannon_S1';

// Both as the current build stores them.
const COLLECTOR_BP = blueprint(
  [
    ingredient(0, 'Titanium', 2, { role: 'SUBSTRATE', minQuality: 900 }),
    ingredient(1, 'Riccite', 2, { role: 'LATTICE', minQuality: 800 }),
  ],
  COLLECTOR,
);
const LASER_CANNON_BP = blueprint(
  [ingredient(0, 'Agricium', 0.36000001430511475, { role: 'FRAME', minQuality: 1 })],
  LASER_CANNON,
);

/**
 * A `getBlueprint` whose answers the spec hands out itself, per class name —
 * so they can arrive in any order, as they may over a slow network.
 */
function answersByHand() {
  const waiting = new Map<string, { resolve(d: BlueprintDetail): void; reject(e: Error): void }>();
  const asked = (className: string) => {
    const w = waiting.get(className);
    if (!w) throw new Error(`the page never asked for ${className}`);
    return w;
  };
  return {
    getBlueprint: (className: string) =>
      new Promise<BlueprintDetail | null>((resolve, reject) => waiting.set(className, { resolve, reject })),
    answer: (detail: BlueprintDetail) => asked(detail.classNameSlug).resolve(detail),
    fail: (className: string, message: string) => asked(className).reject(new Error(message)),
  };
}

/**
 * A params-only navigation to `className`: the router keeps the page and
 * pushes the new params into its route — the header's poly search on a
 * blueprint page, back/forward between two blueprint pages.
 */
async function moveTo(fixture: ComponentFixture<BlueprintDetailComponent>, className: string): Promise<void> {
  (TestBed.inject(ActivatedRoute).paramMap as BehaviorSubject<ParamMap>).next(convertToParamMap({ className }));
  await settle(fixture);
}

/** The class names of the ingredient rows, in page order. */
function ingredientClasses(fixture: ComponentFixture<BlueprintDetailComponent>): string[] {
  const el: HTMLElement = fixture.nativeElement;
  return Array.from(el.querySelectorAll('.ingredient-row .ing-cls')).map((c) => c.textContent!.trim());
}

/** The class name the hero shows, or null while there is no hero. */
function heroClass(fixture: ComponentFixture<BlueprintDetailComponent>): string | null {
  return (fixture.nativeElement as HTMLElement).querySelector('.hero .cls')?.textContent?.trim() ?? null;
}

describe('BlueprintDetailComponent — moving on to another blueprint', () => {
  it('renders the next blueprint, with a skeleton instead of the old rows while it loads', async () => {
    const answers = answersByHand();
    const fixture = await setup(COLLECTOR_BP, undefined, answers.getBlueprint);
    answers.answer(COLLECTOR_BP);
    await settle(fixture);
    expect(ingredientClasses(fixture)).toEqual(['Titanium', 'Riccite']);

    await moveTo(fixture, LASER_CANNON);
    expect(ingredientClasses(fixture)).toEqual([]);
    expect(heroClass(fixture)).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.skel-card')).not.toBeNull();

    answers.answer(LASER_CANNON_BP);
    await settle(fixture);
    expect(ingredientClasses(fixture)).toEqual(['Agricium']);
    expect(heroClass(fixture)).toBe(LASER_CANNON);
  });

  it('keeps the newer blueprint when the one it left answers last', async () => {
    const answers = answersByHand();
    const fixture = await setup(COLLECTOR_BP, undefined, answers.getBlueprint);
    await moveTo(fixture, LASER_CANNON);

    answers.answer(LASER_CANNON_BP);
    await settle(fixture);
    answers.answer(COLLECTOR_BP);
    await settle(fixture);

    expect(ingredientClasses(fixture)).toEqual(['Agricium']);
    expect(heroClass(fixture)).toBe(LASER_CANNON);
  });

  it('drops the error of the blueprint it left', async () => {
    const answers = answersByHand();
    const fixture = await setup(COLLECTOR_BP, undefined, answers.getBlueprint);
    answers.fail(COLLECTOR, 'timeout');
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector('.err')).not.toBeNull();

    await moveTo(fixture, LASER_CANNON);
    answers.answer(LASER_CANNON_BP);
    await settle(fixture);

    expect((fixture.nativeElement as HTMLElement).querySelector('.err')).toBeNull();
    expect(ingredientClasses(fixture)).toEqual(['Agricium']);
  });
});
