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
  template: `<h1 scRoutineStatus>{{ 'feedbackFab.title' | translate }}</h1>`,
})
class HostComponent {}

/**
 * The dev-PC liveness signal as the admin asked for it the second time round
 * (feedback a7573f0e): "nur der Titel oben 'Feedback' soll grün oder Rot
 * markiert sein" — no status line of its own, and nothing louder than a tint.
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
        },
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  }

  const title = () => fixture.nativeElement.querySelector('h1') as HTMLElement;
  /** What a sighted user reads — the hidden state wording does not count. */
  const visibleText = () => {
    const clone = title().cloneNode(true) as HTMLElement;
    clone.querySelector('.sc-routine-tint__sr')?.remove();
    return clone.textContent!.trim();
  };
  const srText = () => title().querySelector('.sc-routine-tint__sr')!.textContent!.trim();

  it('tints the existing title green and adds no wording of its own', async () => {
    await setup('online', iso(5 * MIN));
    expect(title().classList).toContain('sc-routine-tint');
    expect(title().classList).toContain('is-online');
    expect(title().classList).not.toContain('is-offline');
    // The whole point of the follow-up: the panel still just says "Feedback".
    expect(visibleText()).toBe('Feedback');
    // The global tint rules select on the directive's own attribute to outweigh
    // the component-scoped `color` on those titles — so it has to reach the DOM.
    expect(title().hasAttribute('scRoutineStatus')).toBeTrue();
  });

  it('tints it red and keeps naming the last check-in on hover', async () => {
    await setup('offline', iso(3 * 60 * MIN));
    expect(title().classList).toContain('is-offline');
    expect(visibleText()).toBe('Feedback');
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
    // Hidden for the eye, part of the heading for assistive tech — and shown
    // again under forced colours, where the tint itself is overridden.
    expect(srText()).toBe('(Dev PC unreachable)');
    expect(title().getAttribute('title')).toContain('Dev PC unreachable');
  });

  it('repaints when the state flips, without the host re-rendering', async () => {
    await setup('online', iso(5 * MIN));
    state.set('offline');
    fixture.detectChanges();
    expect(title().classList).toContain('is-offline');
    expect(title().classList).not.toContain('is-online');
    expect(srText()).toBe('(Dev PC unreachable)');
    expect(visibleText()).toBe('Feedback');
  });
});
