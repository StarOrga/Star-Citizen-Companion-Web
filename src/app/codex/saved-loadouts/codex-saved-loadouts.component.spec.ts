import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { DraftMap } from '../codex-loadout-draft';
import { CodexSavedLoadoutsComponent } from './codex-saved-loadouts.component';
import { SAVED_LOADOUTS_STORAGE_KEY, SavedLoadout, SavedLoadoutsService } from './saved-loadouts.service';

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

  it('ignores a corrupt store instead of throwing', () => {
    localStorage.setItem(SAVED_LOADOUTS_STORAGE_KEY, '{not json');
    expect(new SavedLoadoutsService().all()).toEqual([]);
  });
});

describe('CodexSavedLoadoutsComponent', () => {
  let fixture: ComponentFixture<CodexSavedLoadoutsComponent>;
  let prompt: jasmine.Spy;
  let confirm: jasmine.Spy;

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
    prompt = jasmine.createSpy('prompt').and.resolveTo('Mining');
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [CodexSavedLoadoutsComponent],
      providers: [
        provideTranslateService({}),
        { provide: ScConfirmService, useValue: { prompt, confirm } },
      ],
    });
  });
  afterEach(() => localStorage.removeItem(SAVED_LOADOUTS_STORAGE_KEY));

  it('cannot save an empty or read-only draft', () => {
    let el = render(new Map());
    expect((el.querySelector('.save') as HTMLButtonElement).disabled).toBeTrue();
    fixture.destroy();
    el = render(new Map([[PORT, 'GUN_A']]), true);
    expect((el.querySelector('.save') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('saves the draft under the prompted name and recalls it', async () => {
    const el = render(new Map([[PORT, 'GUN_A']]));
    expect(el.querySelector('sc-select')).toBeNull();
    await fixture.componentInstance.saveCurrent();
    fixture.detectChanges();

    expect(prompt).toHaveBeenCalled();
    const store = TestBed.inject(SavedLoadoutsService);
    const saved = store.all();
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('Mining');
    expect(el.querySelector('sc-select')).not.toBeNull();

    const recalled: SavedLoadout[] = [];
    fixture.componentInstance.recall.subscribe((l) => recalled.push(l));
    fixture.componentInstance.pick(saved[0].id);
    expect(recalled.length).toBe(1);
    expect(recalled[0].entries).toEqual([[PORT, 'GUN_A']]);
  });

  it('a cancelled prompt saves nothing', async () => {
    prompt.and.resolveTo(null);
    render(new Map([[PORT, 'GUN_A']]));
    await fixture.componentInstance.saveCurrent();
    expect(TestBed.inject(SavedLoadoutsService).all().length).toBe(0);
  });

  it('deletes the selected loadout after the danger confirm', async () => {
    const store = TestBed.inject(SavedLoadoutsService);
    const e = store.save(SHIP, 'Bounty', 'B1', new Map([[PORT, 'GUN_A']]))!;
    render(new Map());
    fixture.componentInstance.pick(e.id);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.remove')).not.toBeNull();
    await fixture.componentInstance.removeSelected(e);
    expect(confirm).toHaveBeenCalledWith(jasmine.objectContaining({ tone: 'danger' }));
    expect(store.all().length).toBe(0);
  });

  it('shows the cart action disabled until a cart exists', () => {
    const el = render(new Map([[PORT, 'GUN_A']]));
    const cart = el.querySelector('.cart') as HTMLButtonElement;
    expect(cart.disabled).toBeTrue();
    expect(cart.getAttribute('aria-describedby')).toBe('codex-saved-loadouts-cart-hint');
    expect(fixture.componentInstance.cartRequests()).toEqual([{ className: 'GUN_A', portPath: PORT, quantity: 1 }]);
  });
});
