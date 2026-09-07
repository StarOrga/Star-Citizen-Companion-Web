import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { ConsentService } from '../core/consent.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { LocaleService } from '../core/locale/locale.service';
import { UserFeedbackPanelComponent } from './user-feedback-panel.component';
import { UserFeedbackService } from './user-feedback.service';
import { AuthorFeedbackMessage, AuthorFeedbackRow } from './user-feedback.types';
import { deepestBoxNesting, drawsBox } from './testing/frame-nesting';

/**
 * The author's half of admin feedback ae072e63 ("passe die alle in allen
 * feedback panels an, dass wir weniger diese Rahmen in Rahmen in Rahmen haben").
 *
 * This panel only ever renders inside the feedback FAB's wall, so the same
 * ceiling as the admin board applies: at most two boxes in here, three with the
 * wall. Before this it ran to four in an answered topic — wall, topic card,
 * reply box, and the reply composer's frame with its field inside.
 */
const T = '2026-09-06T10:00:00Z';

function topic(over: Partial<AuthorFeedbackRow> = {}): AuthorFeedbackRow {
  return {
    id: 't1',
    body: 'Der Filter oben wäre schöner.',
    created_at: T,
    updated_at: T,
    decision_note: null,
    author_status: 'question',
    can_delete: true,
    ...over,
  };
}

function message(over: Partial<AuthorFeedbackMessage> = {}): AuthorFeedbackMessage {
  return {
    id: 'm1',
    feedback_id: 't1',
    author_id: null,
    from_admin: true,
    is_question: true,
    body: 'Oben oder unten?',
    created_at: T,
    ...over,
  };
}

async function mount(rows: AuthorFeedbackRow[], messages: AuthorFeedbackMessage[]) {
  const service = {
    topics: signal(rows),
    busy: signal(false),
    error: signal(null),
    openQuestions: signal(rows.filter((r) => r.author_status === 'question').length),
    newsSinceOpen: signal(new Set<string>()),
    hasNewsSinceOpen: () => false,
    loaded: () => true,
    refresh: () => Promise.resolve(),
    messagesFor: (id: string) => messages.filter((m) => m.feedback_id === id),
  };
  await TestBed.configureTestingModule({
    imports: [UserFeedbackPanelComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: UserFeedbackService, useValue: service },
      // Stubbed so nothing in the composer's dependency chain reaches for a
      // real client or a real session — a pending network task would hold the
      // fixture unstable for the whole spec.
      { provide: SupabaseClientProvider, useValue: { client: {} } as unknown as SupabaseClientProvider },
      {
        provide: AuthService,
        useValue: { user: signal(null), session: signal(null), ready: () => Promise.resolve(), realUser: () => null },
      },
      { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      { provide: LocaleService, useValue: { language: () => 'de', region: () => 'DE' } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(UserFeedbackPanelComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('UserFeedbackPanelComponent — frame nesting', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('draws no box around the compose pane — the panel wall already does', async () => {
    const { el } = await mount([], []);

    const composer = el.querySelector<HTMLElement>('sc-feedback-composer .composer')!;
    expect(composer).not.toBeNull();
    expect(drawsBox(composer)).withContext('the compose box is frameless').toBeFalse();

    const worst = deepestBoxNesting(el);
    expect(worst.depth).withContext(`deepest chain: ${worst.path}`).toBeLessThanOrEqual(1);
  });

  it('nests at most two boxes in an opened topic with a thread and a reply box', async () => {
    const { el, cmp, fixture } = await mount([topic()], [message()]);

    // A topic carrying a question opens itself — that is the state the author
    // actually sees, and the one that used to stack four frames.
    cmp.selectMine();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The thread is there — the chain below is measured on a real reply, not on
    // an empty card.
    const reply = el.querySelector<HTMLElement>('.reply')!;
    expect(reply).not.toBeNull();
    expect(drawsBox(reply)).withContext('a reply is a rule, not a box').toBeFalse();
    expect(parseFloat(getComputedStyle(reply).borderInlineStartWidth)).toBeGreaterThan(0);

    // …and the answer box inside the card does not draw a second frame either.
    const composer = el.querySelector<HTMLElement>('.topic sc-feedback-composer .composer')!;
    expect(composer).not.toBeNull();
    expect(drawsBox(composer)).toBeFalse();

    const worst = deepestBoxNesting(el);
    expect(worst.depth).withContext(`deepest chain: ${worst.path}`).toBeLessThanOrEqual(2);
  });
});
