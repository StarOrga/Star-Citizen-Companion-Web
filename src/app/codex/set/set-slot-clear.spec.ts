import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HangarService } from '../../hangar/hangar.service';
import { RoleLoadoutItem } from '../../hangar/hangar.types';
import { SetSlotClearer } from './set-slot-clear';

// The set page reuses its children across a set switch (redteam R5): an undo
// offered for set A must never write A's piece into set B.

@Component({ selector: 'sc-clearer-host', standalone: true, template: '' })
class HostComponent {
  readonly setId = signal('set-a');
  readonly items = signal<RoleLoadoutItem[]>([{ slot: 'Helmet', className: 'helm_a', kind: 'item' }]);
  readonly clearer = new SetSlotClearer(
    () => this.setId(),
    () => this.items(),
  );
}

describe('SetSlotClearer', () => {
  let writes: { id: string; slot: string; piece: unknown }[];
  let release: (() => void) | null;

  beforeEach(() => {
    writes = [];
    release = null;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HangarService,
          useValue: {
            setRoleLoadoutSlot: (id: string, slot: string, piece: unknown) => {
              writes.push({ id, slot, piece });
              const done = { id, items: [] };
              if (piece === null && !release) {
                return new Promise((r) => (release = () => r(done)));
              }
              return Promise.resolve(done);
            },
          },
        },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  async function clearHelmet(host: HostComponent): Promise<void> {
    const pending = host.clearer.clear('Helmet', 'helm_a');
    release?.();
    await pending;
  }

  it('offers undo for the set the piece was cleared from', async () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    await clearHelmet(host);
    expect(host.clearer.undoable()).toEqual(jasmine.objectContaining({ setId: 'set-a', slot: 'Helmet' }));

    await host.clearer.undo();
    expect(writes[1]).toEqual({ id: 'set-a', slot: 'Helmet', piece: { className: 'helm_a', kind: 'item' } });
  });

  it('drops the undo when the shown set changes, so B never gets A\'s piece', async () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    await clearHelmet(host);
    host.setId.set('set-b');

    expect(host.clearer.undoable()).toBeNull();
    await host.clearer.undo();
    expect(writes.length).toBe(1);
  });

  it('binds the undo to the set at click time even if the set switches mid-write', async () => {
    const host = TestBed.createComponent(HostComponent).componentInstance;
    const pending = host.clearer.clear('Helmet', 'helm_a');
    host.setId.set('set-b');
    release?.();
    await pending;

    expect(writes[0].id).toBe('set-a');
    expect(host.clearer.undoable()).toBeNull(); // offered for A, B is shown
    host.setId.set('set-a');
    expect(host.clearer.undoable()?.setId).toBe('set-a');
  });
});
