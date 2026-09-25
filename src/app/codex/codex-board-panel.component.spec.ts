import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { CodexBoardPanelComponent } from './codex-board-panel.component';
import { ResolvedEntity } from './codex.service';
import { HangarRoleLoadout } from '../hangar/hangar.types';

const OPEN_SET: HangarRoleLoadout = {
  id: 'set-open',
  name: 'Open Set',
  role: 'engineering',
  items: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const OTHER_SET: HangarRoleLoadout = { ...OPEN_SET, id: 'set-other', name: 'Other Set' };

/** A helmet, resolved with a genuine EN/DE payload name plus its slim nameLocalized fallback. */
const HELMET_SET: HangarRoleLoadout = {
  ...OPEN_SET,
  id: 'set-helmet',
  items: [{ slot: 'helmet', className: 'Helmet_01', kind: 'item' }],
};
const HELMET_RESOLVED: ResolvedEntity = {
  kind: 'item',
  className: 'Helmet_01',
  nameLocalized: 'Helmet 01 EN',
  name: { key: '@item_Helmet_01', en: 'Combat Helmet', de: 'Kampfhelm' },
  manufacturerCode: null,
  size: null,
  grade: null,
};

/** Hosts the panel the way the set page does: a plain wrapper carrying --tint, no `.board` class. */
@Component({
  standalone: true,
  imports: [CodexBoardPanelComponent],
  template: `
    <div class="wrap" style="--tint: #ffc14d">
      <sc-codex-board-panel
        [loadouts]="loadouts"
        [resolved]="resolved"
        [payloads]="payloads"
        [archiveDepth]="depth"
      />
    </div>
  `,
})
class HostComponent {
  loadouts = [OPEN_SET, OTHER_SET];
  resolved = new Map();
  payloads = new Map();
  depth = new Map();
}

/** 0–255 channels of a computed colour, whether Chrome reports rgb() or color(srgb …) (color-mix). */
function channels(color: string): number[] {
  const values = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return color.startsWith('color(') ? values.map((v) => Math.round(v * 255)) : values;
}

describe('CodexBoardPanelComponent', () => {
  async function render(setup?: (host: HostComponent) => void): Promise<{
    el: HTMLElement;
    translate: TranslateService;
    detectChanges: () => Promise<void>;
  }> {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    setup?.(fixture.componentInstance);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return {
      el: fixture.nativeElement as HTMLElement,
      translate: TestBed.inject(TranslateService),
      detectChanges: async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
      },
    };
  }

  it('paints open positions blue-grey wherever it is hosted, not only under a ".board" parent', async () => {
    const { el } = await render();
    const square = el.querySelector('.board-sq.empty') as HTMLElement;
    const label = el.querySelector('.board-slot.empty .t-label') as HTMLElement;

    // The squares were invisible on the set page: --idle resolved to nothing,
    // so the dashed border and the idle background both dropped out.
    expect(getComputedStyle(square).borderTopStyle).toBe('dashed');
    expect(getComputedStyle(square).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    // The label is --idle lifted with fg-0 (≈5:1 instead of 2.4:1): still the
    // blue-grey family — blue over red — but no longer the raw #3d5a6c.
    const [r, , b] = channels(getComputedStyle(label).color);
    expect(b).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(61);
    expect(b).toBeLessThan(230);
  });

  it('shows only the readiness classes the set\'s role has a position for', async () => {
    const { el } = await render();
    // An engineering set holds tools only: one gadget glyph, not five that can never light.
    const glyphs = Array.from(el.querySelectorAll('.rdy-ic')).map((g) => g.getAttribute('aria-label'));
    expect(glyphs.length).toBe(1);
    expect(glyphs[0]).toContain('codex.landing.board.readiness.gadget');
  });

  it('switches sets on the set page instead of sending the reader to the landing', async () => {
    const { el } = await render();
    const hrefs = Array.from(el.querySelectorAll('.dial-node')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/codex/set/set-open', '/codex/set/set-other']);
  });

  it('shows the equipped piece name in the current UI language, EN default', async () => {
    const { el } = await render((host) => {
      host.loadouts = [HELMET_SET];
      host.resolved = new Map([['Helmet_01', HELMET_RESOLVED]]);
    });
    const value = el.querySelector('.board-slot .t-value') as HTMLElement;
    expect(value.textContent?.trim()).toBe('Combat Helmet');
  });

  it('follows a language switch to German and back', async () => {
    const { el, translate, detectChanges } = await render((host) => {
      host.loadouts = [HELMET_SET];
      host.resolved = new Map([['Helmet_01', HELMET_RESOLVED]]);
    });

    translate.use('de');
    await detectChanges();
    expect((el.querySelector('.board-slot .t-value') as HTMLElement).textContent?.trim()).toBe('Kampfhelm');

    translate.use('en');
    await detectChanges();
    expect((el.querySelector('.board-slot .t-value') as HTMLElement).textContent?.trim()).toBe('Combat Helmet');
  });

  it('falls back to nameLocalized when the payload carries no localized name', async () => {
    const { el } = await render((host) => {
      host.loadouts = [HELMET_SET];
      host.resolved = new Map([
        ['Helmet_01', { ...HELMET_RESOLVED, name: null }],
      ]);
    });
    const value = el.querySelector('.board-slot .t-value') as HTMLElement;
    expect(value.textContent?.trim()).toBe('Helmet 01 EN');
  });
});
