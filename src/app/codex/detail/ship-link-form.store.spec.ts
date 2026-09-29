import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ShipLinkService } from '../ship-link.service';
import { ShipLinkFormStore } from './ship-link-form.store';

describe('ShipLinkFormStore', () => {
  let store: ShipLinkFormStore;
  let setMyLink: jasmine.Spy;
  const myLinks = signal(new Map<string, string>());

  beforeEach(() => {
    setMyLink = jasmine.createSpy('setMyLink');
    myLinks.set(new Map([['cnou_nomad', 'https://robertsspaceindustries.com/pledge/ships/nomad']]));
    TestBed.configureTestingModule({
      providers: [
        ShipLinkFormStore,
        {
          provide: ShipLinkService,
          useValue: {
            saving: signal(false),
            myLinks,
            globalLinks: signal(new Map<string, string>()),
            setMyLink,
          } as unknown as ShipLinkService,
        },
      ],
    });
    store = TestBed.inject(ShipLinkFormStore);
    store.connect(signal<string | null>('cnou_nomad'));
  });

  it('opens with the own link prefilled, and reset closes and clears', () => {
    store.toggle();
    expect(store.open()).toBeTrue();
    expect(store.input()).toBe('https://robertsspaceindustries.com/pledge/ships/nomad');
    store.onInput('https://example.com/x');
    store.reset();
    expect(store.open()).toBeFalse();
    expect(store.input()).toBe('');
    expect(store.error()).toBeNull();
    expect(store.saved()).toBeFalse();
  });

  it('names a rejected link and does not report it saved', async () => {
    setMyLink.and.resolveTo('invalidUrl');
    store.onInput('not a url');
    await store.save();
    expect(setMyLink).toHaveBeenCalledOnceWith('cnou_nomad', 'not a url');
    expect(store.error()).toBe('invalidUrl');
    expect(store.saved()).toBeFalse();
  });

  it('confirms a saved link', async () => {
    setMyLink.and.resolveTo(null);
    await store.save();
    expect(store.error()).toBeNull();
    expect(store.saved()).toBeTrue();
  });

  it('writes nothing while no ship is open', async () => {
    store.connect(signal<string | null>(null));
    await store.save();
    expect(setMyLink).not.toHaveBeenCalled();
    expect(store.pledgeLink()).toBeNull();
  });
});
