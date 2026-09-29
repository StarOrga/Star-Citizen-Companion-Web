import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';

import { UpcomingShip, UpcomingShipsService } from '../codex/upcoming-ships.service';
import { UpcomingShipsNoticeComponent } from './upcoming-ships-notice.component';

const ship = (id: string, over: Partial<UpcomingShip> = {}): UpcomingShip => ({
  id, name: `Ship ${id}`, manufacturer: null, manufacturerCode: null, productionStatus: null,
  type: null, focus: null, rsiUrl: null, thumbnail: null, thumbnails: [], ...over,
} as UpcomingShip);

class FakeUpcoming {
  readonly added = signal<UpcomingShip[]>([]);
  readonly favoriteUpdates = signal<UpcomingShip[]>([]);
  readonly favorites = signal<ReadonlySet<string>>(new Set());
  readonly feed = signal<object | null>({ ships: [] });
  readonly diff = () => ({ added: this.added(), favoriteUpdates: this.favoriteUpdates() });
  readonly notificationCount = () => this.added().length + this.favoriteUpdates().length;
  readonly refresh = jasmine.createSpy('refresh').and.returnValue(Promise.resolve());
  readonly acknowledge = jasmine.createSpy('acknowledge');
  isFavorite(id: string): boolean {
    return this.favorites().has(id);
  }
}

describe('UpcomingShipsNoticeComponent', () => {
  let svc: FakeUpcoming;

  beforeEach(() => {
    svc = new FakeUpcoming();
    TestBed.configureTestingModule({
      imports: [UpcomingShipsNoticeComponent],
      providers: [provideRouter([]), provideTranslateService({}), { provide: UpcomingShipsService, useValue: svc }],
    });
  });

  function render() {
    const f = TestBed.createComponent(UpcomingShipsNoticeComponent);
    f.detectChanges();
    return f;
  }
  const $ = (f: { nativeElement: HTMLElement }, sel: string) => f.nativeElement.querySelector<HTMLElement>(sel);

  it('renders nothing without a delta — no empty box', () => {
    const f = render();
    expect($(f, '.notice')).toBeNull();
  });

  it('loads the feed silently when it has none yet, and not when it has', () => {
    svc.feed.set(null);
    render();
    expect(svc.refresh).toHaveBeenCalledOnceWith(true);
    svc.refresh.calls.reset();
    svc.feed.set({ ships: [] });
    render();
    expect(svc.refresh).not.toHaveBeenCalled();
  });

  it('lists added ships, marks favorites, and links to the upcoming list', () => {
    svc.added.set([ship('a'), ship('b')]);
    svc.favorites.set(new Set(['b']));
    const f = render();
    expect($(f, '.notice')!.textContent).toContain('news.upcomingShips.addedMany');
    const names = Array.from(f.nativeElement.querySelectorAll('.ship .nm')).map((n) => (n as HTMLElement).textContent!.trim());
    expect(names).toEqual(['Ship a', 'Ship b']);
    expect(f.nativeElement.querySelectorAll('.ship.fav').length).toBe(1);
    expect($(f, 'a.cta')!.getAttribute('href')).toBe('/codex/upcoming');
  });

  it('uses the singular key for one ship', () => {
    svc.added.set([ship('a')]);
    expect($(render(), '.notice')!.textContent).toContain('news.upcomingShips.addedOne');
  });

  it('collapses beyond six names into a "+N more" entry', () => {
    svc.added.set(Array.from({ length: 9 }, (_, i) => ship(`s${i}`)));
    const f = render();
    expect(f.nativeElement.querySelectorAll('.ship:not(.more)').length).toBe(6);
    expect($(f, '.ship.more')!.textContent).toContain('news.upcomingShips.more');
  });

  it('shows favorite status updates with a translated status label', () => {
    svc.favoriteUpdates.set([ship('a', { productionStatus: 'flight-ready' })]);
    const f = render();
    expect($(f, '.notice')!.textContent).toContain('news.upcomingShips.favoritesUpdated');
    expect($(f, '.st')!.textContent!.trim()).toBe('codex.upcoming.status.flightReady');
  });

  it('acknowledges through the dismiss button', () => {
    svc.added.set([ship('a')]);
    const f = render();
    const btn = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.head button')!;
    expect(btn.getAttribute('aria-label')).toBe('news.upcomingShips.dismiss');
    btn.click();
    expect(svc.acknowledge).toHaveBeenCalled();
  });
});
