import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexBoardFigureComponent } from './codex-board-figure.component';
import { SUIT_PARTS, buildHardsuit, paintPart } from './codex-board-suit';
import * as THREE from 'three';

async function setup(
  filled: string[],
  decorative = false,
): Promise<ComponentFixture<CodexBoardFigureComponent>> {
  await TestBed.configureTestingModule({
    imports: [CodexBoardFigureComponent],
    providers: [provideTranslateService({ fallbackLang: 'en' })],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexBoardFigureComponent);
  fixture.componentRef.setInput('filled', new Set(filled));
  fixture.componentRef.setInput('decorative', decorative);
  fixture.detectChanges();
  return fixture;
}

describe('CodexBoardFigureComponent', () => {
  it('renders the drawn suit as the fallback, whatever the engine does', async () => {
    const el: HTMLElement = (await setup([])).nativeElement;
    // The SVG must be in the DOM from the first frame — it is the no-WebGL
    // rendering, not a replacement that arrives later.
    expect(el.querySelector('svg.board-doll')).not.toBeNull();
    expect(el.querySelectorAll('svg.board-doll .pd-part').length).toBe(SUIT_PARTS.length);
    expect(el.querySelector('canvas.board-stage')).not.toBeNull();
  });

  it('marks only the equipped positions', async () => {
    const el: HTMLElement = (await setup(['helmet', 'legs'])).nativeElement;
    const on = Array.from(el.querySelectorAll('svg.board-doll .pd-part.on'));
    expect(on.length).toBe(2);
    expect(on.every((g) => g.getAttribute('fill') === 'url(#pd-plate-on)')).toBeTrue();
    expect(el.querySelector('svg.board-doll .visor')?.getAttribute('fill')).toBe(
      'url(#pd-visor-on)',
    );
  });

  it('leaves the visor open when the helmet is not', async () => {
    const el: HTMLElement = (await setup(['core'])).nativeElement;
    expect(el.querySelector('svg.board-doll .visor')?.getAttribute('fill')).toBe('url(#pd-visor)');
  });

  // Feedback 77668f11: the collapsed AN BORD rail shows the figure and nothing
  // else. Inside that button the suit is decoration — the control already has
  // a name, and the picture must not add a second one.
  it('carries a name of its own, and drops it in decorative mode', async () => {
    const named: HTMLElement = (await setup(['helmet'])).nativeElement;
    const doll = named.querySelector('svg.board-doll');
    expect(doll?.getAttribute('role')).toBe('img');
    expect(doll?.getAttribute('aria-label')).toBe('codex.landing.paperdoll.aria');

    TestBed.resetTestingModule();
    const bare: HTMLElement = (await setup(['helmet'], true)).nativeElement;
    for (const node of [bare.querySelector('svg.board-doll'), bare.querySelector('canvas.board-stage')]) {
      expect(node?.getAttribute('role')).toBeNull();
      expect(node?.getAttribute('aria-label')).toBeNull();
      expect(node?.getAttribute('aria-hidden')).toBe('true');
    }
    // Still the same figure, only unannounced.
    expect(bare.querySelectorAll('svg.board-doll .pd-part.on').length).toBe(1);
    expect(bare.textContent?.trim()).toBe('');
  });
});

describe('buildHardsuit', () => {
  const palette = { idle: '#3d5a6c', tint: '#f0c27b', accent: '#52c1e6' };

  it('models every position as its own group of real geometry', () => {
    const suit = buildHardsuit(THREE, palette);
    for (const part of SUIT_PARTS) {
      expect(suit.armour[part]).toBeDefined();
    }
    // Six groups, none of them empty — an unequipped position is still a body
    // part, which is the whole reason the empty state stopped being a black box.
    expect(suit.root.children.length).toBe(SUIT_PARTS.length);
    expect(suit.root.children.every((g) => g.children.length > 0)).toBeTrue();
    suit.dispose();
  });

  it('paints equipped in the tint and open in the lifted idle', () => {
    const suit = buildHardsuit(THREE, palette);
    const m = suit.armour.core;

    paintPart(THREE, m, palette, true);
    // Not the raw token: the tint is pulled down into the panel's darkness so
    // an equipped suit lights up instead of turning into a gold statue. What
    // must survive is that it is warm and that it glows.
    expect(m.color.r).toBeGreaterThan(m.color.b);
    expect(m.emissive.getHex()).toBeGreaterThan(0);

    paintPart(THREE, m, palette, false);
    // Lifted toward white, so the open suit reads on the dark panel instead of
    // vanishing into it.
    expect(m.color.getHexString()).not.toBe('3d5a6c');
    expect(m.color.r).toBeGreaterThan(new THREE.Color(palette.idle).r);
    expect(m.emissive.getHex()).toBe(0);

    suit.dispose();
  });
});
