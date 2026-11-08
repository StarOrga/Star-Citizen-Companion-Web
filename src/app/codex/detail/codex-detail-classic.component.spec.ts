import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexDetailClassicComponent, type CodexClassicCtx } from './codex-detail-classic.component';

/** A page stand-in with only what a weapon's Klassisch view reads; everything else is empty. */
function weaponCtx(over: Record<string, unknown> = {}): CodexClassicCtx {
  const sig = <T>(v: T) => () => v;
  const base: Record<string, unknown> = {
    detail: sig({ kind: 'weapon', classNameSlug: 'klwe_laser_s1', ports: [] }),
    kind: sig('weapon'),
    isMissile: sig(false),
    heroArt: sig([]),
    heroSub: sig(null),
    heroAttachType: sig(null),
    displayName: sig('Test Laser'),
    manufacturerName: sig('Klaus & Werner'),
    missileKeywords: sig([]),
    skinOptions: sig([]),
    editionOptions: sig([]),
    skinPickerOptions: sig([]),
    editionPickerOptions: sig([]),
    currentLivery: sig(null),
    currentEdition: sig(null),
    facts: sig([{ label: 'Größe', value: 'S1', accent: false }]),
    isPinned: sig(false),
    shareFab: sig(true),
    linkCopied: sig(false),
    fpsSetPiece: sig(null),
    itemPackage: sig(null),
    prefersReducedMotion: sig(true),
    description: sig('A laser.'),
    buyLoading: sig(false),
    buyError: sig(false),
    buyOptions: sig([]),
    damage: sig([{ channel: 'energy', value: 100 }]),
    damagePct: () => 50,
    componentStatGroups: sig([]),
    weaponParamGroups: sig([{ purpose: 'offense', rows: [{ key: 'rpm', i18nKey: null, value: '600', unit: 'rpm' }] }]),
    armorStatGroups: sig([]),
    hardpointGroups: sig([]),
    hasLoadoutSection: sig(false),
    recipeView: sig(null),
    usedInBlueprints: sig([]),
    specSections: sig([]),
    showSpec: sig(false),
    showRaw: sig(false),
    rawJson: sig(''),
    provenance: sig(null),
    fmt: (n: number) => String(n),
    showStatGroupHeaders: () => false,
    togglePin: () => undefined,
    copyShareLink: () => Promise.resolve(),
    toggleSpec: () => undefined,
    toggleRaw: () => undefined,
    ...over,
  };
  return base as unknown as CodexClassicCtx;
}

describe('CodexDetailClassicComponent (frozen Klassisch, non-ship)', () => {
  let fixture: ComponentFixture<CodexDetailClassicComponent>;
  const mount = (ctx: CodexClassicCtx): HTMLElement => {
    fixture = TestBed.createComponent(CodexDetailClassicComponent);
    fixture.componentRef.setInput('ctx', ctx);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CodexDetailClassicComponent],
      providers: [provideRouter([]), provideTranslateService()],
    });
  });

  it('renders the classic masthead: hero card with the name, a fact tile and the compare pin', () => {
    const el = mount(weaponCtx());
    expect(el.querySelector('.m-top > .hero-stack > header.hero.sc-card')).toBeTruthy();
    expect(el.querySelector('.hero-body h1')?.textContent).toContain('Test Laser');
    expect(el.querySelector('.hero-body .mfr')?.textContent).toContain('Klaus');
    expect(el.querySelectorAll('.hero-body .facts .fact').length).toBe(1);
    expect(el.querySelector('.hero-actions button.pin')).toBeTruthy();
  });

  it('keeps the empty m-cols spacer and renders the stat blocks in the classic order', () => {
    const el = mount(weaponCtx());
    expect(el.querySelector('.m-cols.single')).toBeTruthy();
    const heads = Array.from(el.querySelectorAll('section.block > h2')).map((h) => h.textContent ?? '');
    expect(heads.length).toBeGreaterThanOrEqual(3);
    expect(el.querySelector('.dmg-list .dmg[data-ch="energy"]')).toBeTruthy();
    expect(el.querySelector('.stat-grid .stat .s-value')?.textContent).toContain('600');
  });

  it('shows no Holotisch pieces: no item stage, no tabs', () => {
    const el = mount(weaponCtx());
    expect(el.querySelector('sc-codex-item-stage, .it-tabs, .it-panel')).toBeNull();
  });
});
