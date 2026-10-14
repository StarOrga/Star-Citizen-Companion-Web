import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackAreaPickerComponent } from './feedback-area-picker.component';
import { FeedbackAreaService } from './feedback-area.service';
import { FEEDBACK_AREAS, FeedbackArea, FeedbackView } from './feedback-area.types';

/**
 * Stand-in for the router-backed detection. The URL → area mapping itself is
 * covered by `feedback-area.types.spec.ts`; what matters here is the picker's
 * behaviour around that value — which is the part the admin actually asked for
 * ("dass du weißt, worauf man sich bezieht", admin feedback 835fec58).
 */
class FakeAreaService {
  readonly current = signal<FeedbackArea>('news');
  readonly options = signal<readonly FeedbackArea[]>(FEEDBACK_AREAS);
  readonly currentView = signal<FeedbackView | null>(null);
}

describe('FeedbackAreaPickerComponent', () => {
  let fixture: ComponentFixture<FeedbackAreaPickerComponent>;
  let cmp: FeedbackAreaPickerComponent;
  let areas: FakeAreaService;

  async function setup(): Promise<void> {
    areas = new FakeAreaService();
    await TestBed.configureTestingModule({
      imports: [FeedbackAreaPickerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackAreaService, useValue: areas },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackAreaPickerComponent);
    fixture.detectChanges();
    cmp = fixture.componentInstance;
  }

  function chips(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('button.chip'));
  }

  it('pre-selects the area of the page the sender is on', async () => {
    await setup();
    // Nothing was asked of the user and the tag is already there — the whole
    // point of the feature.
    expect(cmp.area()).toBe('news');
    expect(chips().filter((c) => c.classList.contains('active')).length).toBe(1);
  });

  it('follows the route while the sender has not chosen', async () => {
    await setup();
    // The feedback panels stay mounted across navigations: opening the FAB on
    // /news and walking to /codex before typing must tag the topic Codex.
    areas.current.set('codex');
    fixture.detectChanges();
    expect(cmp.area()).toBe('codex');
  });

  it('stops following the route once a chip was clicked', async () => {
    await setup();
    cmp.pick('hangar');
    fixture.detectChanges();
    expect(cmp.area()).toBe('hangar');

    areas.current.set('settings');
    fixture.detectChanges();
    // A deliberate choice must never be silently undone by a navigation.
    expect(cmp.area()).toBe('hangar');
  });

  it('re-arms the detection when the value is cleared after a send', async () => {
    await setup();
    cmp.pick('hangar');
    areas.current.set('settings');
    fixture.detectChanges();
    expect(cmp.area()).toBe('hangar');

    // What the composer does on a successful send.
    cmp.area.set(null);
    fixture.detectChanges();
    expect(cmp.area()).toBe('settings');
  });

  it('keeps a value that was pinned from outside, exactly like a clicked chip', async () => {
    await setup();
    // What the composer does for a seeded topic ("this is about the uploader")
    // while sitting on /admin/telemetry: without the pin the row would flip
    // straight back to Admin.
    cmp.area.set('desktop');
    cmp.pinned.set(true);
    fixture.detectChanges();
    expect(cmp.area()).toBe('desktop');

    areas.current.set('admin');
    fixture.detectChanges();
    expect(cmp.area()).toBe('desktop');

    // …and the clear after a send drops the pin along with the value.
    cmp.area.set(null);
    fixture.detectChanges();
    expect(cmp.pinned()).toBe(false);
    expect(cmp.area()).toBe('admin');
  });

  it('offers exactly the areas the service allows', async () => {
    areas = new FakeAreaService();
    areas.options.set(FEEDBACK_AREAS.filter((a) => a !== 'admin'));
    await TestBed.configureTestingModule({
      imports: [FeedbackAreaPickerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackAreaService, useValue: areas },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(FeedbackAreaPickerComponent);
    fixture.detectChanges();

    // A viewer never sees an "Admin" chip: they cannot reach those pages, so it
    // could only ever be a mis-tag.
    expect(chips().length).toBe(FEEDBACK_AREAS.length - 1);
  });

  describe('Codex view suffix (admin feedback #241)', () => {
    function activeChip(): HTMLButtonElement {
      return chips().find((c) => c.classList.contains('active'))!;
    }

    it('names the view on the active Codex chip and reports it', async () => {
      await setup();
      areas.current.set('codex');
      areas.currentView.set('holo');
      fixture.detectChanges();
      // Untranslated keys are what the test translator renders.
      expect(activeChip().textContent).toContain('codex.holo.toggle.holo');
      expect(cmp.viewFor('codex')).toBe('holo');

      // Flipping the ship page's toggle while the box is open follows along.
      areas.currentView.set('classic');
      fixture.detectChanges();
      expect(activeChip().textContent).toContain('codex.holo.toggle.classic');
      expect(cmp.viewFor('codex')).toBe('classic');
    });

    it('shows no view on a Codex page without one, or under another tag', async () => {
      await setup();
      areas.current.set('codex');
      fixture.detectChanges();
      expect(activeChip().textContent).not.toContain('codex.holo.toggle');
      expect(cmp.viewFor('codex')).toBeNull();

      // On the Holotable, but the sender re-tagged the topic as Hangar: the
      // view belongs to Codex and must not ride along.
      areas.currentView.set('holo');
      cmp.pick('hangar');
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('codex.holo.toggle');
      expect(cmp.viewFor('hangar')).toBeNull();
      expect(cmp.viewFor('codex')).toBeNull();
    });
  });
});
