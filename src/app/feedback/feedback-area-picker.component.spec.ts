import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackAreaPickerComponent } from './feedback-area-picker.component';
import { FeedbackAreaService } from './feedback-area.service';
import { FEEDBACK_AREAS, FeedbackArea } from './feedback-area.types';

/**
 * Stand-in for the router-backed detection. The URL → area mapping itself is
 * covered by `feedback-area.types.spec.ts`; what matters here is the picker's
 * behaviour around that value — which is the part the admin actually asked for
 * ("dass du weißt, worauf man sich bezieht", admin feedback 835fec58).
 */
class FakeAreaService {
  readonly current = signal<FeedbackArea>('news');
  readonly options = signal<readonly FeedbackArea[]>(FEEDBACK_AREAS);
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
});
