import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexBoardPanelComponent } from './codex-board-panel.component';
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

describe('CodexBoardPanelComponent', () => {
  async function render(): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([]), provideTranslateService({})],
    }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('paints open positions blue-grey wherever it is hosted, not only under a ".board" parent', async () => {
    const el = await render();
    const square = el.querySelector('.board-sq.empty') as HTMLElement;
    const label = el.querySelector('.board-slot.empty .t-label') as HTMLElement;

    // The squares were invisible on the set page: --idle resolved to nothing,
    // so the dashed border and the idle background both dropped out.
    expect(getComputedStyle(square).borderTopStyle).toBe('dashed');
    expect(getComputedStyle(square).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(label).color).toBe('rgb(61, 90, 108)');
  });

  it('shows only the readiness classes the set\'s role has a position for', async () => {
    const el = await render();
    // An engineering set holds tools only: one gadget glyph, not five that can never light.
    const glyphs = Array.from(el.querySelectorAll('.rdy-ic')).map((g) => g.getAttribute('aria-label'));
    expect(glyphs.length).toBe(1);
    expect(glyphs[0]).toContain('codex.landing.board.readiness.gadget');
  });

  it('switches sets on the set page instead of sending the reader to the landing', async () => {
    const el = await render();
    const hrefs = Array.from(el.querySelectorAll('.dial-node')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/codex/set/set-open', '/codex/set/set-other']);
  });
});
