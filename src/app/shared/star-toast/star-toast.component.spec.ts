import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { BetaService } from '../../core/beta.service';
import { VerseApiService } from '../../verse/data/verse-api.service';
import { StarEarnedEvent } from '../../verse/data/verse.models';
import { STAR_TOAST_MS, StarToastComponent } from './star-toast.component';

const ev = (key: StarEarnedEvent['key'], lit: number, unlocked: StarEarnedEvent['unlocked'] = []): StarEarnedEvent =>
  ({ key, patchLine: '4.10', lit, total: 7, unlocked });

describe('StarToastComponent', () => {
  const stars = new Subject<StarEarnedEvent>();
  const beta = signal(true);
  const signedIn = signal(true);

  function mount() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: VerseApiService, useValue: { starEarned$: stars.asObservable() } },
        { provide: BetaService, useValue: { isEnabled: () => beta } },
        { provide: AuthService, useValue: { isAuthenticated: signedIn } },
      ],
    });
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', {
      verse: { toast: { lit: 'Star lit: {{task}}', count: '{{lit}} of {{total}}', remaining: '{{n}} more', close: 'Close',
        genericTask: 'New star', unlock: { community: 'Community unlocked', wallpaper: 'Wallpaper unlocked' } } },
      starmap: { task: { notes: { title: 'Notes read' } } },
    });
    t.use('en');
    const f = TestBed.createComponent(StarToastComponent);
    f.detectChanges();
    return f;
  }
  const el = (f: { nativeElement: HTMLElement }) => f.nativeElement as HTMLElement;

  beforeEach(() => { beta.set(true); signedIn.set(true); });

  it('shows a toast with task, count, an unlock line and an anchor to the explorer', fakeAsync(() => {
    const f = mount();
    stars.next(ev('notes', 3, ['community']));
    f.detectChanges();
    const root = el(f);
    expect(root.querySelector('[role=status]')?.getAttribute('aria-live')).toBe('polite');
    expect(root.textContent).toContain('Star lit: Notes read');
    expect(root.textContent).toContain('3 of 7');
    expect(root.textContent).toContain('Community unlocked');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/verse/explorer');
    tick(STAR_TOAST_MS);
    f.detectChanges();
    expect(root.querySelector('.toast')).toBeNull();
  }));

  it('falls back to the remaining-count and a generic task name', fakeAsync(() => {
    const f = mount();
    stars.next(ev('cx-guess', 4));
    f.detectChanges();
    expect(el(f).textContent).toContain('Star lit: New star');
    expect(el(f).textContent).toContain('3 more');
    tick(STAR_TOAST_MS);
  }));

  it('pauses on hover, closes via the x button and queues further events', fakeAsync(() => {
    const f = mount();
    stars.next(ev('notes', 1));
    stars.next(ev('notes', 2));
    f.detectChanges();
    const toast = () => el(f).querySelector('.toast') as HTMLElement;
    tick(STAR_TOAST_MS - 1000);
    toast().dispatchEvent(new Event('mouseenter'));
    tick(STAR_TOAST_MS * 2);
    f.detectChanges();
    expect(el(f).textContent).toContain('1 of 7');
    toast().dispatchEvent(new Event('mouseleave'));
    tick(999);
    f.detectChanges();
    expect(el(f).textContent).toContain('1 of 7');
    tick(2);
    f.detectChanges();
    expect(el(f).textContent).toContain('2 of 7');
    (el(f).querySelector('.x') as HTMLButtonElement).click();
    f.detectChanges();
    expect(toast()).toBeNull();
  }));

  it('stays silent without the Verse beta or without a session', fakeAsync(() => {
    const f = mount();
    beta.set(false);
    f.detectChanges();
    stars.next(ev('notes', 1));
    f.detectChanges();
    expect(el(f).querySelector('.toast')).toBeNull();
    beta.set(true);
    signedIn.set(false);
    f.detectChanges();
    stars.next(ev('notes', 1));
    f.detectChanges();
    expect(el(f).querySelector('.toast')).toBeNull();
  }));
});
