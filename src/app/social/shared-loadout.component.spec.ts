import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { LoadoutShareService } from './loadout-share.service';
import { SharedLoadoutView } from './loadout-share.types';
import { SharedLoadoutComponent } from './shared-loadout.component';

const TOKEN = 'a'.repeat(64);

const view = (over: Partial<SharedLoadoutView> = {}): SharedLoadoutView => ({
  loadout_id: 'l1',
  name: 'Gladius Dogfight',
  role: 'combat' as SharedLoadoutView['role'],
  items: [
    { slot: 'Weapon 1', className: 'BEHR_LaserCannon_S3' },
    { slot: 'Shield', className: null },
  ] as SharedLoadoutView['items'],
  owner_name: 'Owner Name',
  owner_handle: 'pilot_one',
  shared_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
  ...over,
});

async function mount(token: string, result: SharedLoadoutView | null) {
  const getShared = jasmine.createSpy('getShared').and.resolveTo(result);
  TestBed.configureTestingModule({
    imports: [SharedLoadoutComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: LoadoutShareService, useValue: { getShared } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token }) } } },
    ],
  });
  const fixture: ComponentFixture<SharedLoadoutComponent> = TestBed.createComponent(SharedLoadoutComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, getShared };
}

describe('SharedLoadoutComponent', () => {
  it('a valid token renders the loadout: name, owner handle, slots', async () => {
    const { el, getShared } = await mount(TOKEN, view());
    expect(getShared).toHaveBeenCalledWith(TOKEN);
    expect(el.querySelector('h1')?.textContent).toContain('Gladius Dogfight');
    expect(el.querySelector('.byline')?.textContent).toContain('share.view.by');
    const slots = el.querySelectorAll('.slot');
    expect(slots.length).toBe(2);
    expect(slots[0].textContent).toContain('Weapon 1');
    expect(slots[0].textContent).toContain('Laser Cannon');
    // a slot without an item shows a dash, not an empty cell
    expect(slots[1].querySelector('.slot-item')?.textContent?.trim()).toBe('—');
    expect(el.textContent).not.toContain('share.view.unavailable.title');
  });

  it('an empty loadout says so instead of rendering an empty list', async () => {
    const { el } = await mount(TOKEN, view({ items: null }));
    expect(el.querySelector('.slot-list')).toBeNull();
    expect(el.textContent).toContain('share.view.emptyLoadout');
  });

  it('an unknown/revoked token (RPC returns null) shows the not-found text', async () => {
    const { el } = await mount(TOKEN, null);
    expect(el.textContent).toContain('share.view.unavailable.title');
    expect(el.textContent).toContain('share.view.unavailable.body');
    expect(el.querySelector('h1')).toBeNull();
  });

  it('a malformed token never becomes a round trip and shows not-found', async () => {
    const { el, getShared } = await mount('not-a-token!', view());
    expect(getShared).not.toHaveBeenCalled();
    expect(el.textContent).toContain('share.view.unavailable.title');
  });

  it('the call-to-action links are real anchors to /about (both states)', async () => {
    const found = await mount(TOKEN, view());
    const a = found.el.querySelector('a.sc-btn') as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe('/about');
    expect(found.el.querySelectorAll('button').length).toBe(0);
  });

  it('the not-found state also offers an anchor', async () => {
    const { el } = await mount(TOKEN, null);
    expect(el.querySelector('a.sc-btn')?.getAttribute('href')).toBe('/about');
  });
});
