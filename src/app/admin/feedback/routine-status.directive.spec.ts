import { ChangeDetectionStrategy, Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService, provideTranslateService } from '@ngx-translate/core';
import { HeartbeatState, RoutineHeartbeatService } from './routine-heartbeat.service';
import { RoutineStatusDirective } from './routine-status.directive';

const MIN = 60_000;
const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** Stands in for the two real hosts: a title the panel renders anyway. */
@Component({
  standalone: true,
  imports: [TranslateModule, RoutineStatusDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1 scRoutineStatus="feedbackFab.title">{{ 'feedbackFab.title' | translate }}</h1>`,
})
class HostComponent {}

/**
 * The dev-PC liveness signal as the admin asked for it (feedback a7573f0e):
 * "nur der Titel oben 'Feedback' soll grün oder Rot markiert sein" — no status
 * line of its own, and nothing louder than a tint.
 *
 * The round in between shipped a visually hidden span inside the title and it
 * rendered as "(DEV-PC ERREICHBAR)Feedback" on screen, so the assertions below
 * are deliberately about the *whole* element: not "the visible part reads
 * Feedback once you ignore the hidden bits", but "the title has no child nodes
 * and its text is the title, full stop".
 */
describe('RoutineStatusDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let state: WritableSignal<HeartbeatState>;

  async function setup(initial: HeartbeatState, seenAt: string | null) {
    state = signal(initial);
    const stub = {
      state,
      lastSeen: signal(seenAt),
      note: signal<string | null>(null),
      checkedAt: signal(NOW),
      refresh: () => Promise.resolve(),
    };

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' }), { provide: RoutineHeartbeatService, useValue: stub }],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      feedbackFab: { title: 'Feedback' },
      adminFeedback: {
        heartbeat: {
          online: 'Dev PC reachable',
          offline: 'Dev PC unreachable',
          unknown: 'Dev PC status unknown',
          onlineTitle: 'Dev PC reachable - checked in {{time}}.',
          offlineTitle: 'Dev PC unreachable - last checked in {{time}}.',
          unknownTitle: 'Status unknown.',
          ariaLabel: '{{title}} - {{state}}',
        },
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  }

  const title = () => fixture.nativeElement.querySelector('h1') as HTMLElement;

  it('tints the existing title green and adds no wording of its own', async () => {
    await setup('online', iso(5 * MIN));
    expect(title().classList).toContain('sc-routine-tint');
    expect(title().classList).toContain('is-online');
    expect(title().classList).not.toContain('is-offline');
    // The whole point of the follow-up: the panel still just says "Feedback".
    expect(title().textContent).toBe('Feedback');
    // The global tint rules select on the directive's own attribute to outweigh
    // the component-scoped `color` on those titles — so it has to reach the DOM.
    // A static attribute value keeps it there; a binding would not.
    expect(title().hasAttribute('scRoutineStatus')).toBeTrue();
  });

  it('puts nothing at all inside the title element', async () => {
    await setup('offline', iso(3 * 60 * MIN));
    // No element children and exactly one text node: there is no span left
    // that a missing or overridden stylesheet could reveal.
    expect(title().childElementCount).toBe(0);
    expect(title().childNodes.length).toBe(1);
    expect(title().textContent).toBe('Feedback');
    expect(title().textContent).not.toContain('Dev PC');
  });

  it('tints it red and keeps naming the last check-in on hover', async () => {
    await setup('offline', iso(3 * 60 * MIN));
    expect(title().classList).toContain('is-offline');
    expect(title().textContent).toBe('Feedback');
    expect(title().getAttribute('title')).toContain('last checked in');
  });

  it('leaves the title untinted when nothing is known', async () => {
    await setup('unknown', null);
    expect(title().classList).toContain('sc-routine-tint');
    expect(title().classList).not.toContain('is-online');
    expect(title().classList).not.toContain('is-offline');
    expect(title().getAttribute('title')).toBe('Status unknown.');
  });

  it('falls back to the neutral sentence when a known state has no timestamp', async () => {
    await setup('offline', null);
    expect(title().classList).toContain('is-offline');
    expect(title().getAttribute('title')).toBe('Status unknown.');
  });

  it('never leaves colour as the only carrier', async () => {
    await setup('offline', iso(3 * 60 * MIN));
    // Off-screen but part of the accessible name — and it still names the
    // heading, so the state does not replace "Feedback" for a screen reader.
    expect(title().getAttribute('aria-label')).toBe('Feedback - Dev PC unreachable');
    expect(title().getAttribute('title')).toContain('Dev PC unreachable');
  });

  it('repaints when the state flips, without the host re-rendering', async () => {
    await setup('online', iso(5 * MIN));
    expect(title().getAttribute('aria-label')).toBe('Feedback - Dev PC reachable');
    state.set('offline');
    fixture.detectChanges();
    expect(title().classList).toContain('is-offline');
    expect(title().classList).not.toContain('is-online');
    expect(title().getAttribute('aria-label')).toBe('Feedback - Dev PC unreachable');
    expect(title().textContent).toBe('Feedback');
  });
});
