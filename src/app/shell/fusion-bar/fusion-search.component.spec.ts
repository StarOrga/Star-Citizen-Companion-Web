import { TestBed } from '@angular/core/testing';
import { ShellChromeService } from './shell-chrome.service';
import { fakeEngine, fxGroup, setupFusionSearch } from './fusion-search.testing';

/** op-hybrid open behaviour (concept 2026-11-01, round 2). */
describe('FusionSearchComponent op-hybrid', () => {
  function setup() {
    const engine = fakeEngine();
    const h = setupFusionSearch(engine);
    return { ...h, engine, groups: engine.groups };
  }

  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  it('focus alone does not open the panel (autofocus leaves it shut)', () => {
    const { fixture, el, field, cmp } = setup();
    document.body.appendChild(el);
    field.focus();
    field.dispatchEvent(new FocusEvent('focus'));
    fixture.detectChanges();
    expect(cmp.focused()).toBeTrue();
    expect(cmp.open()).toBeFalse();
    expect(el.querySelector('.panel')).toBeNull();
    el.remove();
  });

  it('a click into the field, ↓ or Ctrl+K opens the panel with suggestions', () => {
    const { fixture, el, field, cmp } = setup();
    field.click();
    fixture.detectChanges();
    expect(cmp.open()).withContext('click').toBeTrue();
    expect(el.querySelector('.panel')).not.toBeNull();

    cmp.close();
    fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(cmp.open()).withContext('ArrowDown').toBeTrue();

    cmp.close();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    fixture.detectChanges();
    expect(cmp.open()).withContext('Ctrl+K').toBeTrue();
  });

  it('without a page search the first typed character opens the panel with results', () => {
    const { el, cmp, type } = setup();
    expect(cmp.open()).toBeFalse();
    type('g');
    expect(cmp.open()).toBeTrue();
    expect(el.querySelector('.strip')).toBeNull();
  });

  it('with a page search typing filters the page list, the panel stays shut and the strip offers the whole Codex', () => {
    const { fixture, el, cmp, type, groups } = setup();
    const applied: string[] = [];
    const off = TestBed.inject(ShellChromeService).registerPageSearch({}, (t) => applied.push(t));
    groups.set([fxGroup('ship', [], 7), fxGroup('weapon', [], 5)]);
    type('gla');
    expect(applied).toEqual(['gla']);
    expect(cmp.open()).withContext('panel stays shut').toBeFalse();
    const strip = el.querySelector('.strip') as HTMLButtonElement;
    expect(strip).not.toBeNull();
    expect(cmp.stripTotal()).toBe(12);
    expect(strip.textContent).toContain('fusionBar.search.strip');

    strip.click();
    fixture.detectChanges();
    expect(cmp.open()).withContext('the strip expands the panel').toBeTrue();
    expect(el.querySelector('.strip')).toBeNull();

    cmp.close();
    fixture.detectChanges();
    (el.querySelector('input.input') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    expect(cmp.open()).withContext('↓ expands it too').toBeTrue();
    off();
  });

  it('Escape closes the open panel', () => {
    const { fixture, field, cmp } = setup();
    field.click();
    fixture.detectChanges();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(cmp.open()).toBeFalse();
  });

  it('the placeholder ends in an ellipsis instead of a cut letter, also while focused', () => {
    const { fixture, el, field, type } = setup();
    document.body.appendChild(el);
    field.focus();
    fixture.detectChanges();
    const ph = el.querySelector('.ph') as HTMLElement;
    expect(ph).withContext('drawn placeholder').not.toBeNull();
    expect(ph.getAttribute('aria-hidden')).toBe('true');
    expect(ph.textContent?.trim()).toBe(field.getAttribute('placeholder')!);
    const cs = getComputedStyle(ph);
    expect(cs.textOverflow).toBe('ellipsis');
    expect(cs.whiteSpace).toBe('nowrap');
    expect(cs.overflow).toBe('hidden');
    type('x');
    expect(el.querySelector('.ph')).withContext('gone once typed').toBeNull();
    el.remove();
  });
});
