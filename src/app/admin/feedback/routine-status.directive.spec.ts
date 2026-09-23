import { ChangeDetectionStrategy, Component, WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService, TranslatePipe } from '@ngx-translate/core';
import { HeartbeatState, RoutineHeartbeatService } from './routine-heartbeat.service';
import { RoutineStatusDirective } from './routine-status.directive';

const MIN = 60_000;
const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** Stands in for the two real hosts: a title the panel renders anyway. */
@Component({
  standalone: true,
  imports: [TranslatePipe, RoutineStatusDirective],
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
 *
 * Since the 2026-09-13 concept the hover tooltip is also the honest
 * availability sentence plus the last run's note (option 2d) — still without a
 * single node inside the title.
 */
describe('RoutineStatusDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let state: WritableSignal<HeartbeatState>;
  let note: WritableSignal<string | null>;

  async function setup(initial: HeartbeatState, seenAt: string | null, initialNote: string | null = null) {
    state = signal(initial);
    note = signal<string | null>(initialNote);
    const stub = {
      state,
      lastSeen: signal(seenAt),
      note,
      nextRunAt: signal<string | null>(null),
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
          running: 'Dev PC is working right now',
          paused: 'Routine paused',
          offline: 'Dev PC unreachable',
          unknown: 'Dev PC status unknown',
          onlineTitle: 'Dev PC reachable - checked in {{time}}.',
          runningTitle: 'Dev PC reachable - working right now (checked in {{time}}).',
          pausedTitle: 'Routine paused - checked in {{time}}.',
          offlineTitle: 'Dev PC unreachable - last checked in {{time}}.',
          unknownTitle: 'Status unknown.',
          availability: 'The routine only runs while the dev PC is on.',
          ariaLabel: '{{title}} - {{state}}',
          note: { queueEmpty: 'Last run: nothing open', work: 'Last run: picked up {{n}} topic(s)' },
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

  it('says on hover that the routine depends on the dev PC whenever it is not simply online', async () => {
    await setup('offline', iso(3 * 60 * MIN));
    expect(title().getAttribute('title')).toContain('only runs while the dev PC is on');
    await setup('online', iso(5 * MIN));
    expect(title().getAttribute('title')).not.toContain('only runs while');
  });

  it("translates the gate's note keys and shows a free-text note verbatim", async () => {
    await setup('online', iso(5 * MIN), 'work:3');
    expect(title().getAttribute('title')).toContain('picked up 3 topic(s)');
    await setup('online', iso(5 * MIN), 'queue empty, keine Holds');
    expect(title().getAttribute('title')).toContain('queue empty, keine Holds');
  });

  it('paints a working run in the accent and a paused routine amber, each with its own wording', async () => {
    await setup('running', iso(MIN));
    expect(title().classList).toContain('is-running');
    expect(title().getAttribute('aria-label')).toBe('Feedback - Dev PC is working right now');
    expect(title().getAttribute('title')).toContain('working right now');
    await setup('paused', iso(MIN));
    expect(title().classList).toContain('is-paused');
    expect(title().classList).not.toContain('is-running');
    expect(title().getAttribute('aria-label')).toBe('Feedback - Routine paused');
  });

  it('leaves the title untinted when nothing is known', async () => {
    await setup('unknown', null);
    expect(title().classList).toContain('sc-routine-tint');
    expect(title().classList).not.toContain('is-online');
    expect(title().classList).not.toContain('is-offline');
    expect(title().getAttribute('title')).toBe('Status unknown. · The routine only runs while the dev PC is on.');
  });

  it('falls back to the neutral sentence when a known state has no timestamp', async () => {
    await setup('offline', null);
    expect(title().classList).toContain('is-offline');
    expect(title().getAttribute('title')).toContain('Status unknown.');
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
