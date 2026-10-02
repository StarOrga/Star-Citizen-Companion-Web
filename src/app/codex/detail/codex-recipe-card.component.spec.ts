import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexRecipeCardComponent, RecipeView } from './codex-recipe-card.component';

describe('CodexRecipeCardComponent', () => {
  async function render(recipe: RecipeView): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [CodexRecipeCardComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    const fixture = TestBed.createComponent(CodexRecipeCardComponent);
    fixture.componentRef.setInput('recipe', recipe);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('lists every material with its role, amount and quality floor', async () => {
    const el = await render({
      craftTime: '2 min',
      blueprintSlug: 'BP_CRAFT_AMRS_LaserCannon_S1',
      rows: [
        { key: 1, name: 'Agricium', role: 'Frame', qty: '0.4', minQuality: '500' },
        { key: 2, name: 'Copper', role: null, qty: null, minQuality: null },
      ],
    });

    expect(el.querySelector('h2 .ct')?.textContent).toBe('2 min');
    const items = el.querySelectorAll('.compat-list li');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Agricium');
    expect(items[0].textContent).toContain('Frame');
    expect(items[0].textContent).toContain('0.4 SCU');
    expect(items[0].textContent).toContain('codex.detail.minQuality');
    // A row without role/amount/floor shows just its name — no empty chips.
    expect(items[1].querySelectorAll('.chip').length).toBe(0);
  });

  it('links the blueprint as a real anchor', async () => {
    const el = await render({ craftTime: null, blueprintSlug: 'BP_Foo', rows: [] });
    const a = el.querySelector('a.compat-link') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/codex/blueprint/BP_Foo');
  });

  it('says "no ingredients" and drops the craft-time badge when the blueprint names neither', async () => {
    const el = await render({ craftTime: null, blueprintSlug: 'BP_Foo', rows: [] });
    expect(el.querySelector('.compat-list')).toBeNull();
    expect(el.querySelector('.muted')?.textContent).toContain('codex.detail.noIngredients');
    expect(el.querySelector('h2 .ct')).toBeNull();
  });
});
