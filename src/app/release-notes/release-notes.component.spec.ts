import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ReleaseNotesService, ReleaseNotes } from './release-notes.service';
import { ReleaseNotesComponent } from './release-notes.component';

const SAMPLE: ReleaseNotes = {
  generatedFrom: 'CHANGELOG.md',
  current: '0.26.1',
  releases: [
    {
      version: '0.26.1',
      date: '2026-07-07',
      sections: [{ category: 'Changed', label: '', items: [{ title: 'Telemetry.', text: 'Segmented control.' }] }],
    },
    {
      version: '0.25.0',
      date: '2026-07-06',
      sections: [{ category: 'Migrations / infra', label: '', items: [{ title: '', text: 'DB stuff.' }] }],
    },
  ],
};

describe('ReleaseNotesService', () => {
  let svc: ReleaseNotesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ReleaseNotesService, provideHttpClient(), provideHttpClientTesting()],
    });
    svc = TestBed.inject(ReleaseNotesService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('fetches release-notes.json and caches it (single request)', async () => {
    const p1 = svc.load();
    http.expectOne('release-notes.json').flush(SAMPLE);
    expect(await p1).toEqual(SAMPLE);
    expect(svc.notes()?.current).toBe('0.26.1');

    // Second call must not hit the network again.
    const cached = await svc.load();
    http.expectNone('release-notes.json');
    expect(cached).toEqual(SAMPLE);
  });

  it('resolves to null on HTTP error without throwing', async () => {
    const p = svc.load();
    http.expectOne('release-notes.json').error(new ProgressEvent('fail'));
    expect(await p).toBeNull();
    expect(svc.notes()).toBeNull();
  });
});

describe('ReleaseNotesComponent', () => {
  let fixture: ComponentFixture<ReleaseNotesComponent>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReleaseNotesComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideTranslateService()],
    });
    fixture = TestBed.createComponent(ReleaseNotesComponent);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => TestBed.resetTestingModule());

  it('maps standard categories to a kind and leaves custom ones unmapped', () => {
    const c = fixture.componentInstance;
    expect(c.kind('Changed')).toBe('changed');
    expect(c.kind('Added')).toBe('added');
    expect(c.kind('Security')).toBe('security');
    expect(c.kind('Migrations / infra')).toBeNull();
    expect(c.kind('Deploy')).toBeNull();
  });

  it('renders one timeline entry per release after load', async () => {
    fixture.detectChanges(); // triggers ngOnInit → load()
    http.expectOne('release-notes.json').flush(SAMPLE);
    await fixture.whenStable();
    fixture.detectChanges();

    const releases = fixture.nativeElement.querySelectorAll('.release');
    expect(releases.length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain('v0.26.1');
    expect(fixture.nativeElement.textContent).toContain('Segmented control.');
  });
});
