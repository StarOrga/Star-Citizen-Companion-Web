import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, TranslationObject, provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { BlueprintDetailComponent } from './blueprint-detail.component';
import { BlueprintDetail, CodexService } from './codex.service';
import { CodexBlueprintIngredient } from './codex.types';
import { ItemPathService } from '../hq/data/item-path.service';
import { type FakeItemPath, fakeItemPath } from '../shared/item-path/item-path.testing';
import { UndoToastService } from '../shared/undo-toast/undo-toast.service';
import { WishlistStore } from '../hq/data/wishlist.store';

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
  extra: Partial<CodexService> = {},
): Promise<ComponentFixture<BlueprintDetailComponent>> {
  TestBed.configureTestingModule({
    imports: [BlueprintDetailComponent],
    providers: [
      provideTranslateService(),
      // The page's anchors really navigate here: to a stub, on a mock location.
      provideRouter([{ path: '**', children: [] }]),
      provideLocationMocks(),
      { provide: CodexService, useValue: { getBlueprint, ...extra } as Partial<CodexService> },
      { provide: ItemPathService, useValue: fakeItemPath() },
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
  return Array.from(el.querySelectorAll(`${rowSelector} .ing-qty`)).map((q) =>
    (q.querySelector('.q') ?? q).textContent!.trim(),
  );
}

describe('BlueprintDetailComponent — path (A9)', () => {
  it('carries the path control with its two stops: wish, Inventar', async () => {
    const fixture = await setup(blueprint([ingredient(0, 'Agricium', 0.36)]));
    const el: HTMLElement = fixture.nativeElement;
    const paths = el.querySelectorAll('sc-item-path');
    expect(paths.length).toBe(1);
    expect(Array.from(paths[0].querySelectorAll('.node')).map((n) => n.getAttribute('data-step'))).toEqual(['wish', 'inventar']);
    // Not from Planen or a set: the pill, with the next step as its button.
    expect(paths[0].querySelector('.pill .go')).not.toBeNull();
  });
});

describe('BlueprintDetailComponent — mission (A9)', () => {
  const withMission = (): BlueprintDetail => {
    const d = blueprint([ingredient(0, 'Agricium', 0.36)]);
    d.row['payload'] = {
      className: MICROSAT,
      missionSource: {
        total: 3,
        missions: [
          { className: 'contract_Best', title: { en: 'Routine Patrol', de: '' }, giver: { en: 'Foxwell', de: '' }, location: { en: 'Stanton', de: 'Stanton' } },
          { className: 'contract_Next', title: { en: 'Second Patrol', de: '' }, giver: null, location: null },
        ],
      },
    };
    return d;
  };
  // Not whenStable: the undo toast holds a 6 s window open in the zone.
  const tick = () => new Promise((r) => setTimeout(r));
  afterEach(() => TestBed.inject(UndoToastService).flush());
  const pathOf = () => TestBed.inject(ItemPathService) as unknown as FakeItemPath;
  const pill = (f: ComponentFixture<BlueprintDetailComponent>) => (f.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a.to-mission');
  // preventDefault: a modified click on a real anchor would open a real tab in the test browser.
  const click = (a: HTMLAnchorElement, init: MouseEventInit = {}) => {
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    a.addEventListener('click', (e) => e.preventDefault(), { once: true });
    a.dispatchEvent(ev);
  };

  it('stays plain without data: no mission block, no anchor', async () => {
    const fixture = await setup(blueprint([ingredient(0, 'Agricium', 0.36)]));
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.missions')).toBeNull();
    expect(pill(fixture)).toBeNull();
  });

  it('shows the missions as real anchors to their pages', async () => {
    const fixture = await setup(withMission());
    const el: HTMLElement = fixture.nativeElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.mission-row a.ing-name'));
    expect(links.map((a) => a.textContent!.trim())).toEqual(['Routine Patrol', 'Second Patrol']);
    expect(links[0].getAttribute('href')).toBe('/codex/mission/contract_Best');
    expect(pill(fixture)!.getAttribute('href')).toBe('/codex/mission/contract_Best');
    expect(el.querySelector('.mission-meta')!.textContent).toContain('Foxwell · Stanton');
    expect(el.querySelector('.mission-more')).not.toBeNull();
  });

  it('Zum Einsatz only navigates: a plain click writes nothing (Nachschub is built in the HQ)', async () => {
    const fixture = await setup(withMission());
    click(pill(fixture)!);
    await tick();
    expect(pathOf().addWish).not.toHaveBeenCalled();
    expect(pathOf().moveToInventar).not.toHaveBeenCalled();
  });
});

describe('BlueprintDetailComponent — quantities', () => {
  it('names an ingredient once and puts the SCU unit on its amount (audit L29)', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Agricium', 0.36),
        { ...ingredient(1, 'RAW_Quant_01', 1), nameLocalized: 'Quantanium' },
      ]),
      { blueprint: { detail: { unitScu: 'SCU' } } },
    );
    const el: HTMLElement = fixture.nativeElement;
    const rows = Array.from(el.querySelectorAll('.ingredient-row'));
    expect(rows[0].querySelector('.ing-cls')).toBeNull();
    expect(rows[0].textContent).not.toMatch(/Agricium\s+Agricium/);
    expect(rows[1].querySelector('.ing-cls')?.textContent?.trim()).toBe('RAW_Quant_01');
    expect(rows[0].querySelector('.ing-qty')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('0.36 SCU');
  });


  it('prints a stored float32 SCU amount without its noise (Microsatellite: 0.2 Aluminum + 0.2 Silicon)', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Aluminum', 0.20000000298023224),
        ingredient(1, 'Silicon', 0.20000000298023224),
      ]),
    );
    expect(quantities(fixture, '.ingredient-row')).toEqual(['0.2', '0.2']);
  });

  it('keeps the 0.015 SCU step and whole amounts as they are', async () => {
    const fixture = await setup(
      blueprint([
        ingredient(0, 'Gold', 0.014999999664723873),
        ingredient(1, 'Iron', 15),
        ingredient(2, 'Copper', 12.5),
      ]),
    );
    expect(quantities(fixture, '.ingredient-row')).toEqual(['0.015', '15', '12.5']);
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

/** The ingredient names of the rows, in page order (fixtures name them by class). */
function ingredientClasses(fixture: ComponentFixture<BlueprintDetailComponent>): string[] {
  const el: HTMLElement = fixture.nativeElement;
  return Array.from(el.querySelectorAll('.ingredient-row .ing-name')).map((c) => c.textContent!.trim());
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

describe('BlueprintDetailComponent — hero and output', () => {
  it('shows the class name as a copyable chip, never as the title', async () => {
    const fixture = await setup(blueprint([ingredient(0, 'Aluminum', 1)]));
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.hero h1')?.textContent?.trim()).not.toBe(MICROSAT);
    expect(el.querySelector('.hero sc-class-chip button')).not.toBeNull();
    expect(heroClass(fixture)).toBe(MICROSAT);
  });

  it('names and links the crafted item once the catalog resolves it', async () => {
    const out = 'Carryable_2H_FL_MissionItem_Microsatellite_a';
    const resolveEntities = jasmine.createSpy('resolveEntities').and.resolveTo(
      new Map([[out, { kind: 'item', className: out, nameLocalized: 'Microsatellite', manufacturerCode: null, size: null, grade: null }]]),
    );
    const detail = blueprint([ingredient(0, 'Aluminum', 1)]);
    const fixture = await setup(detail, undefined, async () => detail, { resolveEntities } as Partial<CodexService>);
    await settle(fixture);
    const link = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.output-row a.ing-name');
    expect(resolveEntities).toHaveBeenCalledWith([out]);
    expect(link?.textContent?.trim()).toBe('Microsatellite');
    expect(link?.getAttribute('href')).toBe(`/codex/item/${out}`);
  });

  it('keeps a plain, humanized output line when the lookup fails', async () => {
    const resolveEntities = jasmine.createSpy('resolveEntities').and.rejectWith(new Error('timeout'));
    const detail = blueprint([ingredient(0, 'Aluminum', 1)]);
    const fixture = await setup(detail, undefined, async () => detail, { resolveEntities } as Partial<CodexService>);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.output-row a.ing-name')).toBeNull();
    expect(el.querySelector('.output-row .ing-name')?.textContent?.trim()).toBe('Carryable 2H FL Mission Item Microsatellite a');
    expect(el.querySelector('.err')).toBeNull();
  });
});

describe('BlueprintDetailComponent — Material ×N', () => {
  function wishStore(addQty: (e: { className: string }) => Promise<boolean>) {
    const store = {
      qtyOf: () => 0,
      addQty: jasmine.createSpy('addQty').and.callFake(addQty),
      setQty: jasmine.createSpy('setQty').and.resolveTo(true),
    };
    TestBed.configureTestingModule({ providers: [{ provide: WishlistStore, useValue: store }] });
    return store;
  }

  afterEach(() => TestBed.inject(UndoToastService).flush());

  it('offers the success toast only when every write landed', async () => {
    wishStore(async () => true);
    const fixture = await setup(blueprint([{ ...ingredient(0, 'Agricium', 0.36), nameLocalized: 'Agricium' }]));
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.wish-mat .sc-action') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(TestBed.inject(UndoToastService).current()?.messageKey).toBe('blueprintWish.done');
    expect(el.querySelector('.wish-err')).toBeNull();
  });

  it('names the failure and takes back what landed when a write fails (AUD-11)', async () => {
    const store = wishStore(async (e) => e.className !== 'Agricium');
    const fixture = await setup(blueprint([{ ...ingredient(0, 'Agricium', 0.36), nameLocalized: 'Agricium' }]));
    const el: HTMLElement = fixture.nativeElement;
    (el.querySelector('.wish-mat .sc-action') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(TestBed.inject(UndoToastService).current()).toBeNull();
    expect(el.querySelector('.wish-err')?.textContent).toContain('errors.generic');
    // The blueprint itself landed and went back to its former quantity.
    expect(store.setQty).toHaveBeenCalledWith(jasmine.objectContaining({ kind: 'blueprint' }), 0);
  });
});
