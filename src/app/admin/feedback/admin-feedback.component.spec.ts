import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { LocaleService } from '../../core/locale/locale.service';
import { CelebrationService } from './celebration.service';
import { AdminFeedbackComponent } from './admin-feedback.component';
import { FeedbackMessage, FeedbackRow, FeedbackStatus } from './feedback.types';

/**
 * The stream's state machine (concept 2026-09-04, direction E), rendered
 * against a fake PostgREST: which band a topic lands in, what the lead card
 * offers, how the topic sheet opens, folds, survives a poll and closes on
 * Escape before the shell sees the key, and that a one-tap option posts the
 * option's words and nothing else.
 */

const T = (h: string, d = '01') => `2026-09-${d}T${h}:00:00Z`;
const SELF = 'admin-1';

function row(id: string, status: FeedbackStatus, created: string, extra: Partial<FeedbackRow> = {}): FeedbackRow {
  return {
    id,
    seq: Number(id.replace(/\D/g, '')) || null,
    author_id: SELF,
    body: `Topic ${id}`,
    status,
    ship_ref: null,
    processing_note: null,
    created_at: created,
    updated_at: created,
    shipped_at: null,
    processed_at: null,
    reviewed_at: null,
    source: 'admin',
    triaged: true,
    area: null,
    author: { display_name: 'Jerry Admin', username: 'jerry', role: 'admin' },
    ...extra,
  };
}

function msg(id: string, feedbackId: string, isSystem: boolean, created: string, body = `reply ${id}`): FeedbackMessage {
  return {
    id,
    feedback_id: feedbackId,
    author_id: isSystem ? null : SELF,
    is_system: isSystem,
    body,
    created_at: created,
    author: isSystem ? null : { display_name: 'Jerry Admin', username: 'jerry', role: 'admin' },
  };
}

/**
 * A thenable PostgREST chain: every builder call returns the chain, awaiting it
 * yields the table's rows. Inserts are recorded so a test can assert what left
 * the panel — the only side effect the stream is allowed to have.
 */
function fakeSupabase(tables: Record<string, unknown[]>) {
  const inserts: { table: string; row: unknown }[] = [];
  const updates: { table: string; patch: unknown }[] = [];
  function chain(table: string) {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ['select', 'order', 'in', 'eq', 'limit', 'maybeSingle', 'single', 'upsert', 'delete']) c[m] = self;
    c['insert'] = (r: unknown) => {
      inserts.push({ table, row: r });
      return self();
    };
    c['update'] = (p: unknown) => {
      updates.push({ table, patch: p });
      return self();
    };
    c['then'] = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
    return c;
  }
  const storage = {
    from: () => ({
      upload: () => Promise.resolve({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
    }),
  };
  return {
    provider: { client: { from: (t: string) => chain(t), storage } } as unknown as SupabaseClientProvider,
    inserts,
    updates,
  };
}

async function mount(tables: Record<string, unknown[]>) {
  const sb = fakeSupabase(tables);
  await TestBed.configureTestingModule({
    imports: [AdminFeedbackComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: SupabaseClientProvider, useValue: sb.provider },
      { provide: AuthService, useValue: { user: signal({ id: SELF }), session: signal(null), ready: () => Promise.resolve() } },
      { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      { provide: LocaleService, useValue: { language: () => 'de', region: () => 'DE' } },
      { provide: CelebrationService, useValue: { burst: () => undefined, burstFrom: () => undefined, reducedMotion: () => true } },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminFeedbackComponent);
  fixture.componentRef.setInput('embedded', true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, sb };
}

const QUESTION = 'Soll der Filter oben oder unten sitzen?\n\n[[Oben|Unten]]';

function fixtureTables() {
  const rows = [
    row('q1', 'needs_input', T('08')), // Rückfrage, asked at 10:00 → admin's turn
    row('q2', 'needs_input', T('09')), // Rückfrage, asked at 09:30 → waited longer → first
    row('o1', 'open', T('10')), // routine's pile
    row('r1', 'shipped', T('07'), { shipped_at: T('11'), reviewed_at: null, ship_ref: 'https://github.com/x/y/pull/1' }), // sign-off pending
    row('d1', 'shipped', T('06'), { shipped_at: T('12', '02'), reviewed_at: T('13', '02'), area: 'codex' }), // done
    row('u1', 'open', T('11'), { source: 'user', triaged: false, author_id: 'viewer-1', author: { display_name: 'Vera Viewer', username: 'vera', role: 'viewer' } }),
    row('a1', 'needs_input_author', T('05'), { source: 'user', triaged: true, author_id: 'viewer-1' }),
  ];
  const messages = [
    msg('m1', 'q1', true, T('10'), QUESTION),
    msg('m2', 'q2', true, T('09:30'.slice(0, 2)), 'Kurze Frage ohne Optionen?'),
    msg('m3', 'o1', true, T('10')),
    msg('m4', 'o1', false, T('11')),
  ];
  // q2's question landed at 09:30 — earlier than q1's 10:00.
  messages[1] = { ...messages[1], created_at: '2026-09-01T09:30:00Z' };
  return { admin_feedback: rows, admin_feedback_messages: messages, feedback_author_messages: [] };
}

describe('AdminFeedbackComponent — the stream', () => {
  it('sorts topics into the three bands by whose turn it is', async () => {
    const { cmp } = await mount(fixtureTables());
    // The release first (feedback 89925995: a user topic nobody released is
    // blocked outright), then longest wait first: q2 (asked 09:30) before q1
    // (10:00), then the sign-off (shipped 11:00).
    expect(cmp.yourTurn().map((m) => m.id)).toEqual(['u1', 'q2', 'q1', 'r1']);
    expect(cmp.running().map((m) => m.id).sort()).toEqual(['a1', 'o1']);
    // The feed holds the signed-off ship AND the one still waiting for its ✓.
    const feedIds = cmp.deliveredDays().flatMap((d) => d.items.map((m) => m.id));
    expect(feedIds).toEqual(['d1', 'r1']);
    expect(cmp.deliveredDays()[0].items[0].id).toBe('d1'); // newest day on top
  });

  it('renders the first "Du bist dran" card with its inline action — and the others closed', async () => {
    const { el } = await mount(fixtureTables());
    const cards = Array.from(el.querySelectorAll('.band.yours .card'));
    expect(cards.length).toBe(4);
    expect(cards[0].classList).toContain('lead');
    // The lead is the release: the topic's text and the one red "Freigeben".
    expect(cards[0].querySelector('.card-inline .msg-body')).not.toBeNull();
    expect(cards[0].querySelector('.card-inline .sc-btn.hot')).not.toBeNull();
    expect(cards[0].querySelector('.card-inline sc-feedback-composer')).toBeNull();
    expect(cards[1].querySelector('.card-inline')).toBeNull();
  });

  it('a Rückfrage as the lead card carries the routine’s question and the answer box inline', async () => {
    const tables = fixtureTables();
    tables['admin_feedback'] = (tables['admin_feedback'] as FeedbackRow[]).filter((r) => r.id !== 'u1');
    const { el } = await mount(tables);
    const lead = el.querySelector('.band.yours .card.lead')!;
    expect(lead.id).toBe('fb-card-q2');
    expect(lead.querySelector('.card-inline sc-feedback-composer')).not.toBeNull();
    expect(lead.querySelector('.card-inline .msg.system .ai')).not.toBeNull();
  });

  it('opens a topic as the full-panel sheet, keeps it across a poll, and closes it on Escape before the shell', async () => {
    const { fixture, cmp, el } = await mount(fixtureTables());
    (el.querySelectorAll('.band.yours .card-head')[2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(cmp.openRow()?.id).toBe('q1');
    expect(el.querySelector('.sheet.topic')).not.toBeNull();
    expect(el.querySelector('.sheet.topic .sh-composer sc-feedback-composer')).not.toBeNull();

    await cmp.refresh();
    fixture.detectChanges();
    expect(cmp.openRow()?.id).toBe('q1');

    let reachedDocument = false;
    const spy = () => (reachedDocument = true);
    document.addEventListener('keydown', spy);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (el.querySelector('.sheet.topic .sh-btn') as HTMLElement).dispatchEvent(ev);
    fixture.detectChanges();
    document.removeEventListener('keydown', spy);
    expect(cmp.openRow()).toBeNull();
    expect(reachedDocument).toBeFalse();
  });

  it('shows one-tap options only for a routine question that ends in [[A|B]] — and a click posts the words', async () => {
    const { fixture, cmp, el, sb } = await mount(fixtureTables());
    const q1 = cmp.messages().find((m) => m.id === 'q1')!;
    const q2 = cmp.messages().find((m) => m.id === 'q2')!;
    expect(cmp.answerOptionsFor(q1)?.options).toEqual(['Oben', 'Unten']);
    expect(cmp.answerOptionsFor(q2)).toBeNull();
    // An answered question (human message last) offers nothing to tap.
    const o1 = cmp.messages().find((m) => m.id === 'o1')!;
    expect(cmp.answerOptionsFor(o1)).toBeNull();

    cmp.openTopic('q1');
    fixture.detectChanges();
    const buttons = Array.from(el.querySelectorAll('.sheet.topic .answer-options .option')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Oben', 'Unten']);
    buttons[1].click();
    await fixture.whenStable();
    const posted = sb.inserts.filter((i) => i.table === 'admin_feedback_messages');
    expect(posted.length).toBe(1);
    expect(posted[0].row).toEqual(jasmine.objectContaining({ feedback_id: 'q1', is_system: false, body: 'Unten' }));
  });

  it('folds the thread to the newest message and reveals one more per tap', async () => {
    const tables = fixtureTables();
    tables['admin_feedback_messages'] = [
      msg('t1', 'o1', true, T('10')),
      msg('t2', 'o1', false, T('11')),
      msg('t3', 'o1', true, T('12')),
      msg('t4', 'o1', false, T('13')),
    ];
    const { cmp } = await mount(tables);
    let view = cmp.threadView('o1');
    expect(view.shown.map((m) => m.id)).toEqual(['t4']);
    expect(view.hiddenCount).toBe(3);
    cmp.revealOne(view.key);
    view = cmp.threadView('o1');
    expect(view.shown.map((m) => m.id)).toEqual(['t3', 't4']);
    expect(view.hiddenCount).toBe(2);
    cmp.revealOne(view.key);
    cmp.revealOne(view.key);
    cmp.revealOne(view.key); // one too many is clamped
    view = cmp.threadView('o1');
    expect(view.shown.map((m) => m.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(view.hiddenCount).toBe(0);
    cmp.hideRevealed(view.key);
    expect(cmp.threadView('o1').shown.length).toBe(1);
  });

  it('clamps a sent message longer than three lines until it is unfolded', async () => {
    const { cmp } = await mount(fixtureTables());
    const long = 'Zeile 1\nZeile 2\nZeile 3\nZeile 4\nZeile 5';
    expect(cmp.isLong('x', long)).toBeTrue();
    expect(cmp.isLong('x', 'kurz')).toBeFalse();
    cmp.toggleLong('x');
    expect(cmp.isLong('x', long)).toBeFalse();
  });

  it('narrows every band through the filter sheet and counts the active filters', async () => {
    const { cmp } = await mount(fixtureTables());
    expect(cmp.filterCount()).toBe(0);
    cmp.setWho('users');
    expect(cmp.yourTurn().map((m) => m.id)).toEqual(['u1']);
    expect(cmp.running().map((m) => m.id)).toEqual(['a1']);
    expect(cmp.deliveredDays()).toEqual([]);
    cmp.setWhere('awaiting_author');
    expect(cmp.filterCount()).toBe(2);
    expect(cmp.running().map((m) => m.id)).toEqual(['a1']);
    cmp.resetFilters();
    expect(cmp.filterCount()).toBe(0);
    expect(cmp.whereOptions().map((w) => w.bucket)).toEqual(['awaiting_admin', 'review', 'todo', 'awaiting_author', 'shipped']);
    expect(cmp.areaOptions().map((a) => a.area)).toEqual(['codex']);
  });

  it('colours avatars by role and labels a routine message "AI" without a circle', async () => {
    const tables = fixtureTables();
    tables['admin_feedback'] = (tables['admin_feedback'] as FeedbackRow[]).filter((r) => r.id !== 'u1');
    const { cmp, el } = await mount(tables);
    expect(cmp.toneOf({ display_name: 'x', username: null, role: 'admin' })).toBe('adm');
    expect(cmp.toneOf({ display_name: 'x', username: null, role: 'collaborator' })).toBe('col');
    expect(cmp.toneOf({ display_name: 'x', username: null, role: 'viewer' })).toBe('usr');
    expect(cmp.toneOf(null)).toBe('usr');
    expect(cmp.initials({ display_name: 'Vera Viewer', username: 'vera' }, false)).toBe('VV');
    expect(cmp.initials({ display_name: null, username: 'jerry' }, false)).toBe('JE');
    const lead = el.querySelector('.band.yours .card.lead')!;
    expect(lead.querySelector('.card-head .av.adm')).not.toBeNull();
    expect(lead.querySelector('.card-inline .msg.system .av')).toBeNull();
    expect(lead.querySelector('.card-inline .msg.system .ai')?.textContent?.trim()).toBe('adminFeedback.kind.ai');
  });

  it('puts a delivered row\'s deep link and PR link on the feed card, as real anchors — with unique ids', async () => {
    const { el } = await mount(fixtureTables());
    const done = el.querySelector('#fb-card-d1-feed')!;
    const view = done.querySelector('a.link-btn[href="/codex"]');
    expect(view).not.toBeNull();
    const pending = el.querySelector('#fb-card-r1-feed')!;
    expect(pending.querySelector('a.link-btn[href^="https://github.com"]')?.getAttribute('rel')).toBe('noopener noreferrer');
    // r1 is in "Du bist dran" AND in the feed: two cards, two ids.
    expect(el.querySelectorAll('#fb-card-r1').length).toBe(1);
    expect(el.querySelectorAll('#fb-card-r1-feed').length).toBe(1);
    // Red is the admin avatar and the one primary CTA: the feed's ✓ is not red.
    expect(pending.querySelector('.card-links .sc-btn.hot')).toBeNull();
  });

  /**
   * The sign-off on a stream card is three controls in the card's own body
   * (feedback a398fc94): look at it live, open the topic, sign it off. No frame
   * of its own around them, and no "Gespräch wieder aufnehmen" — reopening a
   * topic means writing WHY, and that happens inside the topic.
   */
  it('shows the sign-off on the lead card frameless, without a second way to reopen', async () => {
    const { el } = await mount({
      admin_feedback: [
        row('r9', 'shipped', T('07'), {
          shipped_at: T('11'),
          reviewed_at: null,
          area: 'codex',
          ship_ref: 'https://github.com/x/y/pull/9',
        }),
      ],
      admin_feedback_messages: [],
    });

    const gate = el.querySelector('.card.lead .card-inline .review-gate')!;
    expect(gate).not.toBeNull();
    expect(gate.classList.contains('inline')).toBeTrue();
    expect(gate.classList.contains('sc-nest')).toBeFalse();

    const labels = Array.from(gate.querySelectorAll('button, a')).map((b) => b.textContent?.trim() ?? '');
    expect(labels.some((l) => l.includes('adminFeedback.actions.viewInApp'))).toBeTrue();
    expect(labels.some((l) => l.includes('adminFeedback.stream.openTopic'))).toBeTrue();
    expect(labels.some((l) => l.includes('adminFeedback.review.accept'))).toBeTrue();
    expect(labels.some((l) => l.includes('adminFeedback.review.reopen'))).toBeFalse();

    // The topic sheet still owns the reopen — the card only dropped the shortcut.
    expect(el.querySelector('.card.lead ~ .inline-actions')).toBeNull();
  });
});
