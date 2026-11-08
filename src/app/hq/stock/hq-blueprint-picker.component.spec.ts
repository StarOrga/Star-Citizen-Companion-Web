import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from '../../codex/codex.service';
import { HqBlueprintPickerComponent, PickedBlueprint } from './hq-blueprint-picker.component';

const hit = (kind: string, classNameSlug: string, name: string) => ({ kind, classNameSlug, name: null, nameLocalized: name });

describe('HqBlueprintPickerComponent (Blaupause aus dem Katalog)', () => {
  function mount(hits: unknown[], owned: string[] = [], fail = false) {
    const searchAll = jasmine.createSpy('searchAll').and.callFake(() => (fail ? Promise.reject(new Error('x')) : Promise.resolve({ hits, totals: {} })));
    TestBed.configureTestingModule({
      imports: [HqBlueprintPickerComponent],
      providers: [provideTranslateService(), { provide: CodexService, useValue: { searchAll } }],
    });
    const f = TestBed.createComponent(HqBlueprintPickerComponent);
    f.componentRef.setInput('owned', new Set(owned));
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, searchAll };
  }

  async function type(f: ReturnType<typeof mount>['f'], text: string): Promise<void> {
    jasmine.clock().install();
    try {
      f.componentInstance.onInput(text);
      jasmine.clock().tick(250);
    } finally {
      jasmine.clock().uninstall();
    }
    await f.whenStable();
    f.detectChanges();
  }

  it('offers only blueprints from the Codex, with their class name', async () => {
    const { f, el } = mount([hit('item', 'arrow_gun', 'Arrowhead Gun'), hit('blueprint', 'BP_Arrowhead', 'Arrowhead'), hit('blueprint', 'bp_arrowhead', 'Arrowhead')]);
    const got: PickedBlueprint[] = [];
    f.componentInstance.picked.subscribe((b) => got.push(b));
    await type(f, 'arrow');
    expect(f.componentInstance.hits().map((h) => h.className)).toEqual(['BP_Arrowhead']);
    (el.querySelector('.list li button') as HTMLButtonElement).click();
    expect(got).toEqual([{ className: 'BP_Arrowhead', name: 'Arrowhead' }]);
  });

  it('shows a blueprint already in the Sammlung without an add button', async () => {
    const { f, el } = mount([hit('blueprint', 'BP_Arrowhead', 'Arrowhead')], ['bp_arrowhead']);
    await type(f, 'arrow');
    expect(el.querySelector('.list li button')).toBeNull();
    expect(el.querySelector('.have')?.textContent).toContain('hq.bestand.bpPick.owned');
  });

  it('does not search for a single letter, and a failed search is a translated error', async () => {
    const one = mount([]);
    await type(one.f, 'a');
    expect(one.searchAll).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const bad = mount([], [], true);
    await type(bad.f, 'arrow');
    expect(bad.el.querySelector('.err')?.textContent?.trim()).toMatch(/^errors\./);
  });
});
