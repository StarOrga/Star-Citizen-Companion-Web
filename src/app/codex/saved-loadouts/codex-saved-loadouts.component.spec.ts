import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { DraftMap } from '../codex-loadout-draft';
import { CodexSavedLoadoutsComponent } from './codex-saved-loadouts.component';
import { decodeDraftParam } from '../codex-loadout-draft';
import {
  SAVED_LOADOUTS_STORAGE_KEY,
  SavedLoadout,
  SavedLoadoutsService,
  layoutShareUrl,
  nextLayoutNumber,
} from './saved-loadouts.service';

const SHIP = 'cnou_nomad';
const PORT = 'hardpoint_weapon_top_left';

describe('SavedLoadoutsService', () => {
  beforeEach(() => localStorage.removeItem(SAVED_LOADOUTS_STORAGE_KEY));
  afterEach(() => localStorage.removeItem(SAVED_LOADOUTS_STORAGE_KEY));

  it('saves a named draft per ship, overwrites the same name and survives a reload', () => {
    const a = new SavedLoadoutsService();
    const first = a.save(SHIP, ' Mining ', 'B1', new Map([[PORT, 'GUN_A']]));
    expect(first?.name).toBe('Mining');
    a.save(SHIP, 'Mining', 'B1', new Map([[PORT, 'GUN_B']]));
    a.save('other_ship', 'Mining', 'B1', new Map([[PORT, 'GUN_C']]));
    expect(a.all().length).toBe(2);

    // A fresh instance reads what the first one stored (localStorage).
    const b = new SavedLoadoutsService();
    const mine = b.all().filter((l) => l.shipClassName === SHIP);
    expect(mine.length).toBe(1);
    expect(mine[0].id).toBe(first!.id);
    expect(mine[0].entries).toEqual([[PORT, 'GUN_B']]);
  });

  it('refuses an empty name or an empty draft, and removes by id', () => {
    const s = new SavedLoadoutsService();
    expect(s.save(SHIP, '   ', 'B1', new Map([[PORT, 'GUN_A']]))).toBeNull();
    expect(s.save(SHIP, 'Leer', 'B1', new Map())).toBeNull();
    const e = s.save(SHIP, 'Bounty', 'B1', new Map([[PORT, null]]))!;
    s.remove(e.id);
    expect(s.all().length).toBe(0);
  });

  it('keeps layouts in creation order and overwrites one in place', () => {
    const s = new SavedLoadoutsService();
    const one = s.save(SHIP, 'Layout 1', 'B1', new Map([[PORT, 'GUN_A']]))!;
    const two = s.save(SHIP, 'Layout 2', 'B1', new Map([[PORT, 'GUN_B']]))!;
    // Re-saving Layout 1 must not move it behind Layout 2.
    s.overwrite(one.id, 'B2', new Map([[PORT, 'GUN_C']]));
    const layouts = s.layoutsOf(SHIP);
    expect(layouts.map((l) => l.id)).toEqual([one.id, two.id]);
    expect(layouts[0].entries).toEqual([[PORT, 'GUN_C']]);
    expect(layouts[0].buildId).toBe('B2');
    expect(s.overwrite('missing', 'B1', new Map([[PORT, 'GUN_A']]))).toBeNull();
    expect(s.overwrite(one.id, 'B1', new Map())).toBeNull();
  });

  it('picks the first free "Layout N" number', () => {
    const nameFor = (n: number) => `Layout ${n}`;
    expect(nextLayoutNumber([], nameFor)).toBe(1);
    expect(nextLayoutNumber(['Layout 1', 'Mining', 'layout 3'], nameFor)).toBe(2);
    expect(nextLayoutNumber(['Layout 1', 'Layout 2'], nameFor)).toBe(3);
  });

  it('builds a share link the ship page restores the layout from', () => {
    const entry: SavedLoadout = {
      id: 'x', shipClassName: SHIP, name: 'Layout 1', buildId: 'B1',
      entries: [[PORT, 'GUN_A'], ['hardpoint_b', null]], savedAt: '2026-11-09T00:00:00Z',
    };
    const url = new URL(layoutShareUrl('https://example.test/codex/ship/cnou_nomad?tab=x#frag', entry)!);
    expect(url.pathname).toBe('/codex/ship/cnou_nomad');
    expect(url.searchParams.get('tab')).toBe('x');
    expect(url.hash).toBe('');
    const decoded = decodeDraftParam(url.searchParams.get('loadout'));
    expect(decoded?.buildId).toBe('B1');
    expect(decoded?.entries).toEqual([[PORT, 'GUN_A'], ['hardpoint_b', null]]);
    expect(layoutShareUrl('https://example.test/', { ...entry, entries: [] })).toBeNull();
  });

  it('ignores a corrupt store instead of throwing', () => {
    localStorage.setItem(SAVED_LOADOUTS_STORAGE_KEY, '{not json');
    expect(new SavedLoadoutsService().all()).toEqual([]);
  });
});

describe('CodexSavedLoadoutsComponent', () => {
  let fixture: ComponentFixture<CodexSavedLoadoutsComponent>;
  let prompt: Mock;
  let confirm: Mock;

  function render(draft: DraftMap, readOnly = false): HTMLElement {
    fixture = TestBed.createComponent(CodexSavedLoadoutsComponent);
    fixture.componentRef.setInput('shipClassName', SHIP);
    fixture.componentRef.setInput('buildId', 'B1');
    fixture.componentRef.setInput('draft', draft);
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.removeItem(SAVED_LOADOUTS_STORAGE_KEY);
    prompt = vi.fn().mockName('prompt').mockResolvedValue('Mining');
    confirm = vi.fn().mockName('confirm').mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [CodexSavedLoadoutsComponent],
      providers: [
        provideTranslateService({}),
        { provide: ScConfirmService, useValue: { prompt, confirm } },
      ],
    });
  });
  afterEach(() => localStorage.removeItem(SAVED_LOADOUTS_STORAGE_KEY));

  it('cannot start a layout from an empty or read-only draft', () => {
    let el = render(new Map());
    expect((el.querySelector('.new') as HTMLButtonElement).disabled).toBe(true);
    fixture.destroy();
    el = render(new Map([[PORT, 'GUN_A']]), true);
    expect((el.querySelector('.new') as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Neues Layout" saves under the prompted name, shows the switch and recalls on pick', async () => {
    const el = render(new Map([[PORT, 'GUN_A']]));
    expect(el.querySelector('.layout')).toBeNull();
    await fixture.componentInstance.saveNew();
    fixture.detectChanges();

    expect(prompt).toHaveBeenCalled();
    const store = TestBed.inject(SavedLoadoutsService);
    const saved = store.all();
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('Mining');
    const chips = el.querySelectorAll('.layout');
    expect(chips.length).toBe(1);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');

    const recalled: SavedLoadout[] = [];
    fixture.componentInstance.recall.subscribe((l) => recalled.push(l));
    fixture.componentInstance.pick(saved[0].id);
    expect(recalled.length).toBe(1);
    expect(recalled[0].entries).toEqual([[PORT, 'GUN_A']]);
  });

  it('an empty name falls back to the suggested default name', async () => {
    prompt.mockResolvedValue('   ');
    render(new Map([[PORT, 'GUN_B']]));
    const fallback = fixture.componentInstance.defaultName();
    await fixture.componentInstance.saveNew();
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ initialValue: fallback }));
    expect(TestBed.inject(SavedLoadoutsService).layoutsOf(SHIP).map((l) => l.name)).toEqual([fallback]);
  });

  it('a cancelled prompt saves nothing', async () => {
    prompt.mockResolvedValue(null);
    render(new Map([[PORT, 'GUN_A']]));
    await fixture.componentInstance.saveNew();
    expect(TestBed.inject(SavedLoadoutsService).all().length).toBe(0);
  });

  it('"Layout speichern" writes the draft into the picked layout', () => {
    const store = TestBed.inject(SavedLoadoutsService);
    const e = store.save(SHIP, 'Bounty', 'B1', new Map([[PORT, 'GUN_A']]))!;
    render(new Map([[PORT, 'GUN_B']]));
    expect(fixture.nativeElement.querySelector('.save')).toBeNull();
    fixture.componentInstance.pick(e.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.save')).not.toBeNull();
    fixture.componentInstance.saveCurrent();
    expect(store.get(e.id)?.entries).toEqual([[PORT, 'GUN_B']]);
    expect(store.all().length).toBe(1);
  });

  it('"Layout teilen" copies the layout link and reports a refused clipboard', async () => {
    const store = TestBed.inject(SavedLoadoutsService);
    const e = store.save(SHIP, 'Bounty', 'B1', new Map([[PORT, 'GUN_A']]))!;
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    render(new Map());
    await fixture.componentInstance.shareSelected(e);
    const copied = new URL(write.mock.calls[0][0]);
    expect(decodeDraftParam(copied.searchParams.get('loadout'))?.entries).toEqual([[PORT, 'GUN_A']]);
    expect(fixture.componentInstance.statusKey()).toBe('codex.savedLoadouts.shareCopied');
    write.mockRejectedValue(new Error('denied'));
    await fixture.componentInstance.shareSelected(e);
    expect(fixture.componentInstance.statusKey()).toBe('codex.savedLoadouts.shareFailed');
    write.mockRestore();
  });

  it('deletes the selected loadout after the danger confirm', async () => {
    const store = TestBed.inject(SavedLoadoutsService);
    const e = store.save(SHIP, 'Bounty', 'B1', new Map([[PORT, 'GUN_A']]))!;
    render(new Map());
    fixture.componentInstance.pick(e.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.remove')).not.toBeNull();
    await fixture.componentInstance.removeSelected(e);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(store.all().length).toBe(0);
  });

  it('shows the cart action disabled until a cart exists', () => {
    const el = render(new Map([[PORT, 'GUN_A']]));
    const cart = el.querySelector('.cart') as HTMLButtonElement;
    expect(cart.disabled).toBe(true);
    expect(cart.getAttribute('aria-describedby')).toBe('codex-saved-loadouts-cart-hint');
    expect(fixture.componentInstance.cartRequests()).toEqual([{ className: 'GUN_A', portPath: PORT, quantity: 1 }]);
  });
});
