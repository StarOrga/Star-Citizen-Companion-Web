import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { HoloReadyBadgeComponent } from './holo-ready-badge.component';
import { ShowroomEntry, ShowroomService } from './showroom.service';

describe('HoloReadyBadgeComponent', () => {
  function entry(shipId: string, modelCount: number): ShowroomEntry {
    return { shipId, liveryCount: 1, modelCount, sources: [], latestAdded: '', posterUrl: null };
  }

  async function setup(entries: ShowroomEntry[], shipId: string) {
    const list = signal(entries);
    const showroom = {
      entries: list.asReadonly(),
      modelShipIds: computed(() => new Set(list().filter((e) => e.modelCount > 0).map((e) => e.shipId))),
      load: jasmine.createSpy('load').and.resolveTo(undefined),
    };
    await TestBed.configureTestingModule({
      imports: [HoloReadyBadgeComponent],
      providers: [provideTranslateService({}), { provide: ShowroomService, useValue: showroom }],
    }).compileComponents();
    const fixture = TestBed.createComponent(HoloReadyBadgeComponent);
    fixture.componentRef.setInput('shipId', shipId);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, showroom, list };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows the badge with a screen-reader name for a ship that has a 3D model', async () => {
    const { el, showroom } = await setup([entry('AEGS_Gladius', 2)], 'AEGS_Gladius');
    expect(el.querySelector('.holo-badge')).not.toBeNull();
    expect(el.querySelector('.sc-sr-only')?.textContent).toContain('codex.skins.holoReady');
    // Already discovered — no second load.
    expect(showroom.load).not.toHaveBeenCalled();
  });

  it('renders nothing for a ship without a model, even with liveries', async () => {
    const { el } = await setup([entry('AEGS_Gladius', 0), entry('ANVL_Hornet', 1)], 'AEGS_Gladius');
    expect(el.querySelector('.holo-badge')).toBeNull();
    expect(el.textContent?.trim()).toBe('');
  });

  it('fills an empty discovery cache once and appears when the model arrives', async () => {
    const { fixture, el, showroom, list } = await setup([], 'AEGS_Gladius');
    expect(showroom.load).toHaveBeenCalledTimes(1);
    expect(el.querySelector('.holo-badge')).toBeNull();

    list.set([entry('AEGS_Gladius', 1)]);
    fixture.detectChanges();
    expect(el.querySelector('.holo-badge')).not.toBeNull();
  });
});
