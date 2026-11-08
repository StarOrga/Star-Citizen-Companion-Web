import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HangarService } from './hangar.service';
import { SharedLoadoutAdopter, holoConfigLink, holoSharedLink } from './shared-loadout-adopter.service';

describe('SharedLoadoutAdopter (#646)', () => {
  let order: string[];
  let navigate: Mock;
  let adoptSharedLoadout: Mock;

  beforeEach(() => {
    order = [];
    adoptSharedLoadout = vi.fn().mockName('adopt').mockImplementation(async () => {
      order.push('adopt');
      return { id: 'cfg-9' };
    });
    const loadAll = vi.fn().mockName('loadAll').mockImplementation(async () => {
      order.push('loadAll');
    });
    navigate = vi.fn().mockName('navigate').mockImplementation(async () => {
      order.push('navigate');
      return true;
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: HangarService, useValue: { adoptSharedLoadout, loadAll } },
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  it('adopts, reloads the hangar, THEN opens the adopted config as the Holotable draft', async () => {
    const ok = await TestBed.inject(SharedLoadoutAdopter).adoptAndOpen('tok', 'AEGS_Gladius');
    expect(ok).toBe(true);
    expect(order).toEqual(['adopt', 'loadAll', 'navigate']);
    expect(navigate).toHaveBeenCalledWith(['/codex', 'ship', 'AEGS_Gladius'], { queryParams: { view: 'holo', config: 'cfg-9' } });
  });

  it('a failed adopt navigates nowhere', async () => {
    adoptSharedLoadout.mockResolvedValue(null);
    const ok = await TestBed.inject(SharedLoadoutAdopter).adoptAndOpen('tok', 'AEGS_Gladius');
    expect(ok).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('builds the two Holotable links', () => {
    expect(holoSharedLink('X', 't')).toEqual({ commands: ['/codex', 'ship', 'X'], queryParams: { view: 'holo', shared: 't' } });
    expect(holoConfigLink('X', 'c')).toEqual({ commands: ['/codex', 'ship', 'X'], queryParams: { view: 'holo', config: 'c' } });
  });
});
