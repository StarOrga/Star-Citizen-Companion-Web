import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ReleaseNotes, ReleaseNotesService } from '../release-notes/release-notes.service';
import { ReleaseSeenService } from '../release-notes/release-seen.service';
import { AboutComponent } from './about.component';

describe('About — "Neu im Verse" card states', () => {
  let notes: ReturnType<typeof signal<ReleaseNotes | null>>;
  let loading: ReturnType<typeof signal<boolean>>;
  let error: ReturnType<typeof signal<string | null>>;
  let load: jasmine.Spy;

  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AboutComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: ReleaseNotesService, useValue: { notes, loading, error, load } },
        { provide: ReleaseSeenService, useValue: { markSeen: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(AboutComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    notes = signal<ReleaseNotes | null>(null);
    loading = signal(false);
    error = signal<string | null>(null);
    load = jasmine.createSpy('load').and.resolveTo(null);
  });

  it('shows a busy placeholder while the release notes load', () => {
    loading.set(true);
    const el = render();
    expect(el.querySelector('.state[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the translated error with a retry that loads again', () => {
    error.set('errors.network');
    const el = render();
    const alert = el.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('errors.network');
    load.calls.reset();
    (alert.querySelector('button') as HTMLButtonElement).click();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shows the feature card once the notes are there', () => {
    notes.set({
      generatedFrom: 'CHANGELOG.md',
      current: '1.2.0',
      releases: [{ version: '1.2.0', date: '2026-10-25', sections: [{ category: 'Added', label: '', items: [{ title: 'Neu', text: 'Text' }] }] }],
    });
    const el = render();
    expect(el.querySelector('article.feature')?.textContent).toContain('v1.2.0');
    expect(el.querySelector('.state')).toBeNull();
  });
});
