import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AuthService } from '../../auth/auth.service';
import { deepestBoxNesting, drawsBox } from '../../feedback/testing/frame-nesting';
import { ConsentService } from '../../core/consent.service';
import { LocaleService } from '../../core/locale/locale.service';
import { CelebrationService } from './celebration.service';
import { FeedbackMotionService } from './feedback-motion.service';
import { AdminFeedbackComponent } from './admin-feedback.component';
import { PanelNavigationService } from '../../feedback/panel-navigation.service';
import { FeedbackMessage, FeedbackRow, FeedbackStatus } from './feedback.types';

/**
 * The stream's state machine (concept 2026-09-04, direction E), rendered
 * against a fake PostgREST: which band a topic lands in, that every row stays
 * closed, how the topic sheet opens, folds, survives a poll and closes on
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

/** The motion service, with its waits cut out: the spec records what folded. */
function fakeMotion() {
  const folded: string[] = [];
  const restored: string[] = [];
  return {
    folded,
    restored,
    service: {
      reducedMotion: true,
      reveal: () => undefined,
      collapse: (el: HTMLElement | null) => {
        if (el) folded.push(el.id);
        return Promise.resolve();
      },
      restore: (el: HTMLElement | null) => {
        if (el) restored.push(el.id);
      },
    } as unknown as FeedbackMotionService,
  };
}

async function mount(tables: Record<string, unknown[]>) {
  const sb = fakeSupabase(tables);
  const motion = fakeMotion();
  await TestBed.configureTestingModule({
    imports: [AdminFeedbackComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ fallbackLang: 'en' }),
      { provide: SupabaseClientProvider, useValue: sb.provider },
      { provide: AuthService, useValue: { user: signal({ id: SELF }), session: signal(null), ready: () => Promise.resolve(), realUser: () => null } },
      { provide: ConsentService, useValue: { preferencesAllowed: () => false } },
      { provide: LocaleService, useValue: { language: () => 'de', region: () => 'DE' } },
      { provide: CelebrationService, useValue: { burst: () => undefined, burstFrom: () => undefined, reducedMotion: () => true } },
      { provide: FeedbackMotionService, useValue: motion.service },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(AdminFeedbackComponent);
  fixture.componentRef.setInput('embedded', true);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, cmp: fixture.componentInstance, el: fixture.nativeElement as HTMLElement, sb, motion };
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

  /**
   * Admin feedback 0691a00b: "die issues sollten nicht aufgeklappt /
   * aufklappbar sein, weil es reicht wenn man drauf drückt das man dann rein
   * geht". The first "Du bist dran" card used to unfold its answer box, the
   * sign-off or the release inline — every row is now a closed head, and the
   * act lives in the opened topic.
   */
  it('renders every "Du bist dran" card closed — no inline answer box, sign-off or release', async () => {
    const { el } = await mount(fixtureTables());
    const cards = Array.from(el.querySelectorAll('.band.yours .card'));
    expect(cards.length).toBe(4);
    for (const card of cards) {
      expect(card.classList).not.toContain('lead');
      expect(card.querySelector('.card-inline')).withContext(card.id).toBeNull();
      expect(card.querySelector('sc-feedback-composer')).withContext(card.id).toBeNull();
      expect(card.querySelector('.review-gate')).withContext(card.id).toBeNull();
      expect(card.querySelector('.msg-body')).withContext(card.id).toBeNull();
      // Nothing on the row but its head: the one tap into the topic.
      expect(card.querySelectorAll('button').length).withContext(card.id).toBe(1);
      expect(card.querySelector('button')?.classList).toContain('card-head');
    }
  });

  it('a Rückfrage answers in the opened topic, not on the card', async () => {
    const tables = fixtureTables();
    tables['admin_feedback'] = (tables['admin_feedback'] as FeedbackRow[]).filter((r) => r.id !== 'u1');
    const { fixture, cmp, el } = await mount(tables);
    const first = el.querySelector('.band.yours .card')!;
    expect(first.id).toBe('fb-card-q2');
    expect(first.querySelector('sc-feedback-composer')).toBeNull();
    (first.querySelector('.card-head') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(cmp.openRow()?.id).toBe('q2');
    const sheet = el.querySelector('.sheet.topic')!;
    expect(sheet.querySelector('.sh-composer sc-feedback-composer')).not.toBeNull();
    expect(sheet.querySelector('.msg.system .ai')).not.toBeNull();
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

  /**
   * Admin feedback 187574ed: "wenn ich in dem issue drin bin brauche ich die
   * Headerzeile mit Profil und Statusleiste etc. nicht mehr, ich will ja dann
   * lesen: erster Post + letzter Post + Inputfeld".
   *
   * The two chrome rows are gone from the opened topic. The one thing on them
   * that was NOT repeated anywhere else in this sheet — the PR / issue behind
   * the topic — moved into the ⋯ menu instead of disappearing with them.
   */
  it('opens the topic straight into the reading: no profile row, no status bar', async () => {
    const { fixture, cmp, el } = await mount(fixtureTables());
    cmp.openTopic('r1');
    fixture.detectChanges();

    const sheet = el.querySelector('.sheet.topic')!;
    expect(sheet.querySelector('.sh-meta')).withContext('no profile row').toBeNull();
    expect(sheet.querySelector('.sh-status')).withContext('no status bar').toBeNull();
    // What is left, in this order: the first post, then the composer.
    expect(sheet.querySelector('.sh-body')!.firstElementChild!.classList)
      .withContext('the topic itself opens the body')
      .toContain('msg');
    expect(sheet.querySelector('.sh-composer sc-feedback-composer')).not.toBeNull();

    cmp.toggleMore('r1');
    fixture.detectChanges();
    const link = Array.from(sheet.querySelectorAll('.more-menu a')).find(
      (a) => a.getAttribute('href') === 'https://github.com/x/y/pull/1',
    ) as HTMLAnchorElement | undefined;
    expect(link).withContext('the ship link is still reachable').not.toBeUndefined();
    expect(link!.target).toBe('_blank');
    expect(link!.rel).toBe('noopener noreferrer');
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

  /**
   * The filter sheet used to answer each question with a column of full-width
   * rows: one option per line, so a three-question sheet outgrew its scroll
   * port and cut the fourth "Wer?" option in half (admin feedback 04013a4c,
   * screenshot at ~490 px). The answers are chips now — they sit side by side
   * and wrap, and every option of every group is in the DOM.
   */
  it('answers every filter question with side-by-side chips that wrap', async () => {
    const { fixture, cmp, el } = await mount(fixtureTables());
    cmp.openFilters();
    fixture.detectChanges();
    const sheet = el.querySelector('.sheet.filters')!;
    const groups = Array.from(sheet.querySelectorAll('.f-chips')) as HTMLElement[];
    expect(groups.length).toBe(3); // Wer? / Wo steht es? / Bereich
    expect(sheet.querySelector('.f-rows')).toBeNull(); // no stacked rows left

    for (const g of groups) {
      // Wrapping, never a sideways scroll — and the group labels itself.
      expect(getComputedStyle(g).flexWrap).toBe('wrap');
      expect(g.scrollWidth).toBeLessThanOrEqual(g.clientWidth + 1);
      expect(g.getAttribute('role')).toBe('group');
      expect(g.getAttribute('aria-label')).toBeTruthy();
      for (const chip of Array.from(g.querySelectorAll('.f-chip')) as HTMLElement[]) {
        // 48, not 44: two overlapping scale animations shave a pixel off a
        // touch target under the mobile gate. Holds in both media branches.
        expect(getComputedStyle(chip).minHeight).toBe('48px');
        expect(chip.getAttribute('aria-pressed')).toBeTruthy();
      }
    }

    // Every option is rendered: the four "Wer?" answers plus one chip per
    // distinct author, and "Alle …" plus one chip per non-empty bucket / area.
    expect(groups[0].querySelectorAll('.f-chip').length).toBe(4 + cmp.authorOptions().length);
    expect(groups[1].querySelectorAll('.f-chip').length).toBe(1 + cmp.whereOptions().length);
    expect(groups[2].querySelectorAll('.f-chip').length).toBe(1 + cmp.areaOptions().length);

    // The counts survived the move into the chip.
    const whereCounts = Array.from(groups[1].querySelectorAll('.f-count')).map((c) => c.textContent?.trim());
    expect(whereCounts).toEqual(cmp.whereOptions().map((w) => String(w.count)));
    expect(groups[2].querySelector('.f-chip.on .f-count')).toBeNull(); // "Alle Bereiche" has no count
    expect(groups[2].querySelectorAll('.f-count').length).toBe(cmp.areaOptions().length);
  });

  it('moves the selected-chip mark as the pick changes', async () => {
    const { fixture, cmp, el } = await mount(fixtureTables());
    cmp.openFilters();
    fixture.detectChanges();
    const who = () => Array.from(el.querySelectorAll('.sheet.filters .f-chips')[0].querySelectorAll('.f-chip')) as HTMLButtonElement[];
    expect(who().map((b) => b.classList.contains('on'))).toEqual([true, false, false, false, false, false]);
    expect(who()[0].getAttribute('aria-pressed')).toBe('true');

    who()[3].click(); // "Nutzer-Feedback" — the option the old layout clipped
    fixture.detectChanges();
    expect(cmp.whoFilter()).toBe('users');
    expect(who().map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false', 'false']);
    expect(who().filter((b) => b.classList.contains('on')).length).toBe(1); // single choice

    // An author chip is the same single-choice set, one tier down.
    who()[4].click();
    fixture.detectChanges();
    expect(cmp.whoIsAuthor(cmp.authorOptions()[0].id)).toBeTrue();
    expect(who()[3].getAttribute('aria-pressed')).toBe('false');
    expect(who()[4].classList).toContain('sub');
  });

  it('colours avatars by role and labels a routine message "AI" without a circle', async () => {
    const tables = fixtureTables();
    tables['admin_feedback'] = (tables['admin_feedback'] as FeedbackRow[]).filter((r) => r.id !== 'u1');
    const { fixture, cmp, el } = await mount(tables);
    expect(cmp.toneOf({ display_name: 'x', username: null, role: 'admin' })).toBe('adm');
    expect(cmp.toneOf({ display_name: 'x', username: null, role: 'collaborator' })).toBe('col');
    expect(cmp.toneOf({ display_name: 'x', username: null, role: 'viewer' })).toBe('usr');
    expect(cmp.toneOf(null)).toBe('usr');
    expect(cmp.initials({ display_name: 'Vera Viewer', username: 'vera' }, false)).toBe('VV');
    expect(cmp.initials({ display_name: null, username: 'jerry' }, false)).toBe('JE');
    const first = el.querySelector('.band.yours .card')!;
    expect(first.querySelector('.card-head .av.adm')).not.toBeNull();
    // The routine's message is drawn in the opened topic (the card stays closed).
    cmp.openTopic('q2');
    fixture.detectChanges();
    const sheet = el.querySelector('.sheet.topic')!;
    expect(sheet.querySelector('.msg.system .av')).toBeNull();
    expect(sheet.querySelector('.msg.system .ai')?.textContent?.trim()).toBe('adminFeedback.kind.ai');
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
   * A pending sign-off in "Du bist dran" is a closed row like any other (admin
   * feedback 0691a00b) — no gate unfolded on the card. The ✓ lives on the
   * delivered-feed copy of the row and in the opened topic's composer line.
   */
  it('keeps a pending sign-off closed in "Du bist dran" and signs it off from the feed or the topic', async () => {
    const { fixture, cmp, el } = await mount({
      admin_feedback: [
        row('r9', 'shipped', T('07'), {
          shipped_at: T('11'),
          reviewed_at: null,
          area: 'codex',
          ship_ref: 'https://github.com/x/y/pull/9',
        }),
      ],
      admin_feedback_messages: [],
      feedback_author_messages: [],
    });

    const yours = el.querySelector('#fb-card-r9')!;
    expect(yours.querySelector('.review-gate')).toBeNull();
    expect(yours.querySelector('.card-inline')).toBeNull();
    expect(yours.querySelectorAll('button').length).toBe(1);

    const feed = el.querySelector('#fb-card-r9-feed')!;
    expect(feed.querySelector('.card-links .sc-btn')?.textContent).toContain('adminFeedback.review.accept');

    cmp.openTopic('r9');
    fixture.detectChanges();
    expect(el.querySelector('.sheet.topic .sh-composer .sign-off')).not.toBeNull();
  });

  /**
   * Admin feedback 187574ed, round 2: "auf der detailseite eines issues, kann
   * in app ansehen raus […] Abgenommen sollte als button neben antworten links
   * rein […] Gespärch wiederaufnehmen button ist auch unnötig".
   *
   * The opened topic keeps exactly two moves for a pending sign-off, and both
   * of them are on the composer's line: accept it, or answer it.
   */
  it('decides a pending sign-off from the composer row, with no gate and no deep link', async () => {
    const { fixture, cmp, el } = await mount({
      admin_feedback: [
        row('r1', 'shipped', T('07'), {
          shipped_at: T('11'),
          reviewed_at: null,
          area: 'codex',
          ship_ref: 'https://github.com/x/y/pull/1',
        }),
      ],
      admin_feedback_messages: [],
      feedback_author_messages: [],
    });
    cmp.openTopic('r1');
    fixture.detectChanges();

    const sheet = el.querySelector('.sheet.topic')!;
    expect(sheet.querySelector('.review-gate')).withContext('no review box in the sheet').toBeNull();

    // The sign-off is IN the composer, left of the send button.
    const signOff = sheet.querySelector<HTMLButtonElement>('.sh-composer .sign-off')!;
    expect(signOff).not.toBeNull();
    expect(signOff.textContent).toContain('adminFeedback.review.accept');
    const send = sheet.querySelector<HTMLElement>('.sh-composer .foot .send')!;
    expect(signOff.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING)
      .withContext('sign-off comes before the send button')
      .toBeTruthy();

    // "In App ansehen" is the card's job — the ⋯ menu keeps only the PR link.
    cmp.toggleMore('r1');
    fixture.detectChanges();
    const items = Array.from(sheet.querySelectorAll('.more-menu a, .more-menu button')).map(
      (n) => n.textContent ?? '',
    );
    expect(items.some((t) => t.includes('adminFeedback.actions.viewInApp'))).toBeFalse();
  });

  /**
   * The reopen semantics survive the button that used to carry them
   * (docs/feedback-routine.md, "Contract" / "Post-ship review & continue"):
   * reply first, `status='open'` second. A topic already in the work loop is
   * left alone — a plain reply must not reset a running claim.
   */
  it('reopens a finished topic through the reply itself, and only a finished one', async () => {
    const { cmp, sb } = await mount({
      admin_feedback: [
        row('r1', 'shipped', T('07'), { shipped_at: T('11'), reviewed_at: null }), // sign-off pending
        row('d1', 'shipped', T('06'), { shipped_at: T('12'), reviewed_at: T('13') }), // archived
        row('o1', 'open', T('10')), // already in the queue
      ],
      admin_feedback_messages: [],
      feedback_author_messages: [],
    });

    for (const id of ['r1', 'd1']) {
      sb.updates.length = 0;
      await cmp.sheetReplySubmitFor(id)({ text: `steer for ${id}`, images: [] });
      expect(sb.inserts.some((i) => i.table === 'admin_feedback_messages'))
        .withContext('the reason lands in the thread first')
        .toBeTrue();
      expect(sb.updates.map((u) => u.patch))
        .withContext(`${id} goes back into the routine's queue`)
        .toEqual([
          { status: 'open', reviewed_at: null, processing_note: null, processed_at: null },
        ]);
    }

    sb.updates.length = 0;
    await cmp.sheetReplySubmitFor('o1')({ text: 'one more thing', images: [] });
    expect(sb.updates).withContext('an open topic is not re-opened').toEqual([]);
  });

  // #518: nothing reads these any more. The panel is the only place that can
  // reach them for an admin who never touches the consent settings — and the
  // purge must not wait on consent (`preferencesAllowed` is false in mount()).
  it('drops the retired localStorage keys on load, regardless of consent', async () => {
    const retired = [
      'sc.adminFeedback.view',
      'sc.adminFeedback.handled',
      'sc.adminFeedback.workflowScope',
      'sc.adminFeedback.workflowKind',
    ];
    for (const key of retired) localStorage.setItem(key, 'stale');
    localStorage.setItem('sc.adminFeedback.lastSeenDelivered', '123');

    await mount(fixtureTables());

    for (const key of retired) expect(localStorage.getItem(key)).toBeNull();
    // the marker the Geliefert band still uses is not collateral damage
    expect(localStorage.getItem('sc.adminFeedback.lastSeenDelivered')).not.toBeNull();
    // …but it must not leak into the next spec: with it set, every later
    // mount shows the "neu" badge (an untranslated key, 190 px wide) in the
    // Geliefert band head, and the width specs fail on spec order alone.
    localStorage.removeItem('sc.adminFeedback.lastSeenDelivered');
  });


  /**
   * #517: the panel tells its shell that an in-app link was followed, so a
   * phone sheet can stop covering the page it just opened. Driven through the
   * handler rather than a DOM click on purpose — the anchor is a real
   * `routerLink` (see the deep-link test above), and letting Karma follow it
   * would navigate the test runner itself away.
   */
  it('reports an in-app navigation only for a plain left click', async () => {
    const { cmp } = await mount(fixtureTables());
    const nav = TestBed.inject(PanelNavigationService);
    const before = nav.navigations();

    expect(cmp.onViewInApp(new MouseEvent('click'))).toBe(true);
    expect(nav.navigations()).toBe(before + 1);

    // Ctrl / ⌘ / Shift / middle open a new tab — this one stays put, so the
    // panel must not minimize under the user.
    expect(cmp.onViewInApp(new MouseEvent('click', { ctrlKey: true }))).toBe(false);
    expect(cmp.onViewInApp(new MouseEvent('click', { metaKey: true }))).toBe(false);
    expect(cmp.onViewInApp(new MouseEvent('click', { button: 1 }))).toBe(false);
    expect(nav.navigations()).toBe(before + 1);
  });

});

/**
 * The flight path's four steps, drawn (feedback 1d013d69). The point of the
 * change is that the four dots now SAY what they are, so these tests read the
 * rendered glyph and its name — not the helper that picks them, which
 * `feedback.types.spec.ts` covers on its own.
 */
describe('AdminFeedbackComponent — the flight path reads as four steps', () => {
  /** The glyph names of one card's path, left to right. */
  function stepsOf(el: HTMLElement, cardId: string): string[] {
    const path = el.querySelector<HTMLElement>(`#fb-card-${cardId} .fp`)!;
    return Array.from(path.querySelectorAll('i')).map(
      (i) => Array.from(i.classList).find((c) => c.startsWith('g-'))?.slice(2) ?? '',
    );
  }

  it('gives every step a drawing and its own name, and keeps the path itself labelled', async () => {
    const { el } = await mount(fixtureTables());

    // Four steps, four different drawings — a repeated `d` would mean two steps
    // look identical, which is the bug this feedback was about.
    const path = el.querySelector<HTMLElement>('#fb-card-o1 .fp')!;
    const steps = Array.from(path.querySelectorAll('i'));
    expect(steps.length).toBe(4);
    const paths = steps.map((i) => i.querySelector('svg path')!.getAttribute('d'));
    expect(paths.every((d) => !!d && d.length > 0)).toBeTrue();
    expect(new Set(paths).size).toBe(4);

    // Each step names itself on hover…
    expect(steps.map((i) => i.getAttribute('title'))).toEqual([
      'adminFeedback.station.step.contract',
      'adminFeedback.station.step.doing',
      'adminFeedback.station.step.delivered',
      'adminFeedback.station.step.accepted',
    ]);
    // …and the drawings themselves stay out of the accessibility tree, because
    // the path as a whole carries one name that says where the topic stands.
    for (const svg of Array.from(path.querySelectorAll('svg'))) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
    expect(path.getAttribute('role')).toBe('img');
    expect(path.getAttribute('aria-label')).toContain('adminFeedback.station.pathLabel');
  });

  it('maps each status to the step it is meant to draw', async () => {
    const { el } = await mount({
      ...fixtureTables(),
      admin_feedback: [
        ...(fixtureTables().admin_feedback as FeedbackRow[]),
        row('x1', 'declined', T('04'), { source: 'user', triaged: true }),
      ],
    });

    // ToDo / in Arbeit → the tool.
    expect(stepsOf(el, 'o1')).toEqual(['contract', 'doing', 'delivered', 'accepted']);
    // Rückfrage an den Admin, and Rückfrage an den Autor → the loop arrow.
    expect(stepsOf(el, 'q1')[1]).toBe('recycle');
    expect(stepsOf(el, 'a1')[1]).toBe('recycle');
    // Abgelehnt → the cross takes the tool's place (a declined topic is
    // archived, so it is drawn in the Geliefert feed).
    expect(stepsOf(el, 'x1-feed')[1]).toBe('rejected');
    // Geliefert (Abnahme offen) and abgenommen keep the two checks; the fill
    // class is what says which of the two the topic has reached.
    expect(stepsOf(el, 'r1')).toEqual(['contract', 'doing', 'delivered', 'accepted']);
    expect(el.querySelector('#fb-card-r1 .fp')!.classList).toContain('s2');
    expect(el.querySelector('#fb-card-d1-feed .fp')!.classList).toContain('s3');
    // The unreleased user topic sits on the contract step.
    expect(el.querySelector('#fb-card-u1 .fp')!.classList).toContain('s0');
  });

  it('paints "Rückfrage an dich" and its loop arrow in the admin red — and only that one (7a450101)', async () => {
    const { el } = await mount(fixtureTables());

    // The routine's question to the admin: baton word + station-2 glyph red.
    const askedBaton = el.querySelector<HTMLElement>('#fb-card-q1 .baton')!;
    expect(askedBaton.textContent!.trim()).toBe('adminFeedback.ask.question');
    expect(askedBaton.classList).toContain('ask-question');
    expect(el.querySelector('#fb-card-q1 .fp')!.classList).toContain('hot');

    // The same loop arrow for a question to the AUTHOR is not this reader's
    // turn — it keeps the normal colour, as does a plain in-progress card.
    expect(el.querySelector('#fb-card-a1 .baton')!.classList).not.toContain('ask-question');
    expect(el.querySelector('#fb-card-a1 .fp')!.classList).not.toContain('hot');
    expect(el.querySelector('#fb-card-o1 .fp')!.classList).not.toContain('hot');
  });
});

describe('AdminFeedbackComponent — the Fortschritt door wears the house icon', () => {
  it('draws a stroke glyph in currentColor, not an emoji, and keeps its name', async () => {
    const { fixture, el } = await mount(fixtureTables());

    const door = el.querySelector<HTMLElement>('.tb-btn.progress')!;
    expect(door).toBeTruthy();

    // The same 24×24 stroke idiom the flight path and the Codex icons use, so
    // the button's colour reaches the icon (admin feedback a33ba528).
    const path = door.querySelector<SVGPathElement>('svg path')!;
    expect(door.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 24 24');
    expect((path.getAttribute('d') ?? '').length).toBeGreaterThan(0);
    expect(path.getAttribute('stroke')).toBe('currentColor');
    expect(path.getAttribute('fill')).toBe('none');

    // No emoji left anywhere in the button — that was the whole finding.
    expect(door.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u);

    // The drawing stays out of the accessibility tree; the button keeps the
    // name and tooltip that say where the door leads.
    expect(door.querySelector('.tb-icon')!.getAttribute('aria-hidden')).toBe('true');
    expect(door.getAttribute('aria-label')).toBe('adminFeedback.stream.progressHint');
    expect(door.getAttribute('title')).toBe('adminFeedback.stream.progressHint');

    // …and the page behind the door carries the same mark.
    door.click();
    fixture.detectChanges();
    const head = el.querySelector<HTMLElement>('.tb-icon.head')!;
    expect(head).toBeTruthy();
    expect(head.querySelector('svg path')!.getAttribute('d')).toBe(path.getAttribute('d'));
    expect(head.getAttribute('aria-hidden')).toBe('true');
  });
});

/**
 * The overview's own surface (admin feedback 96259f21). Three findings from one
 * screenshot of the docked panel: the list scrolled sideways, every row spelled
 * out "AUFTRAG" next to an avatar that already says the same in colour, and the
 * rows sat in a light haze that read as a box drawn around each band's group.
 *
 * Karma renders at 749 px, so the measurements pin their own width instead of
 * trusting the window — and the invariants below hold in both media branches.
 */
describe('AdminFeedbackComponent — the overview fits its panel', () => {
  function inHost(el: HTMLElement, width: number) {
    let host = document.getElementById('fb-width-host') as HTMLElement | null;
    if (!host) {
      host = document.createElement('div');
      host.id = 'fb-width-host';
      host.style.cssText = 'height:600px;display:flex;flex-direction:column;overflow:hidden;';
      document.body.appendChild(host);
    }
    // Adopt on every call, not only when the host is fresh: a host left over
    // from an earlier spec used to leave `el` sitting in the body at its full
    // width, so the measurements below silently graded an unconstrained
    // element and passed or failed on spec order alone.
    if (el.parentElement !== host) host.appendChild(el);
    host.style.width = `${width}px`;
    void host.offsetWidth; // flush layout
    return host;
  }

  afterEach(() => document.getElementById('fb-width-host')?.remove());

  it('never scrolls sideways — at panel width and at board width', async () => {
    const { el } = await mount(fixtureTables());

    for (const width of [360, 480, 720]) {
      inHost(el, width);
      const scroll = el.querySelector<HTMLElement>('.scroll.stream')!;
      expect(getComputedStyle(scroll).overflowX).toBe('hidden');
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);

      // The band head is where it went wrong: `.chev` is an inline glyph, and
      // rotating it 90° when the band is open turned its line height into its
      // width, overhanging the row by ~3 px — enough for a scrollbar under the
      // whole list. Every row of the list has to stay inside its own box.
      for (const head of Array.from(el.querySelectorAll<HTMLElement>('.band-head'))) {
        expect(head.scrollWidth).toBeLessThanOrEqual(head.clientWidth + 1);
      }
      const chev = el.querySelector<HTMLElement>('.band-head .chev.open')!;
      expect(chev.getBoundingClientRect().width).toBeLessThanOrEqual(17);
    }
  });

  it('leaves the order-vs-feedback distinction to the avatar colour, no words', async () => {
    const { el } = await mount(fixtureTables());

    // The words are gone from every row of every band…
    expect(el.querySelectorAll('.ch-meta .kind').length).toBe(0);
    expect(el.querySelector('.scroll.stream')!.textContent).not.toContain('adminFeedback.kind.order');
    expect(el.querySelector('.scroll.stream')!.textContent).not.toContain('adminFeedback.kind.userFeedback');

    // …and the colour that carries the distinction is still on the avatar:
    // the admin's own topics red, the viewer's topic grey-blue.
    expect(el.querySelector('#fb-card-o1 .card-head .av.adm')).not.toBeNull();
    expect(el.querySelector('#fb-card-u1 .card-head .av.usr')).not.toBeNull();
  });

  it('stands the rows on the panel surface — no fill and no glow to merge into a box', async () => {
    const { el } = await mount(fixtureTables());
    const cards = Array.from(el.querySelectorAll<HTMLElement>('.scroll.stream .card'));
    expect(cards.length).toBeGreaterThan(1);
    for (const card of cards) {
      const cs = getComputedStyle(card);
      // `.sc-card`'s 16 px cyan glow on rows 8 px apart merged into one light
      // haze around each band — the "shared background" of the finding.
      expect(cs.boxShadow).toBe('none');
      expect(cs.backgroundImage).toBe('none');
      expect(cs.backgroundColor).toBe('rgba(0, 0, 0, 0)');
      // The outline stays: it is what separates one row from the next.
      expect(parseFloat(cs.borderTopWidth)).toBeGreaterThan(0);
    }
  });
});

/**
 * FRAME NESTING (admin feedback ae072e63: "schau mal wie viele
 * Randverschachtelungen wir haben! 4 Stück im Feedback Panel mit der Außenwand,
 * ich finde 3 maximal, wenn nicht sogar nur 2 maximal").
 *
 * The docked panel draws a wall of its own, OUTSIDE this component, so the
 * admin's three on screen is a ceiling of TWO boxes in here — see
 * `feedback/testing/frame-nesting`, which the user panel's spec measures with
 * too. Every surface that already frames its content therefore embeds the
 * composer `frameless` instead of letting it draw a second box a few pixels
 * inside the first.
 */
describe('AdminFeedbackComponent — frame nesting', () => {
  it('nests at most two boxes inside the panel wall, in the stream', async () => {
    const { el } = await mount(fixtureTables());
    const worst = deepestBoxNesting(el);
    expect(worst.depth).withContext(`deepest chain: ${worst.path}`).toBeLessThanOrEqual(2);
  });

  it('nests at most two boxes with the new-topic sheet open, and the sheet is not one of them', async () => {
    const { el, fixture } = await mount(fixtureTables());
    el.querySelector<HTMLButtonElement>('.new-topic-bar')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const sheet = el.querySelector<HTMLElement>('.compose-sheet')!;
    expect(sheet).not.toBeNull();
    // The sheet parts itself from the stream with a rule, not a frame — so the
    // chain down to the field is panel wall → field, and nothing between.
    expect(drawsBox(sheet)).toBeFalse();
    expect(parseFloat(getComputedStyle(sheet).borderTopWidth)).toBeGreaterThan(0);
    expect(sheet.querySelector('.composer.frameless')).not.toBeNull();

    const worst = deepestBoxNesting(el);
    expect(worst.depth).withContext(`deepest chain: ${worst.path}`).toBeLessThanOrEqual(2);
  });

  it('nests at most two boxes in an opened topic, author channel included', async () => {
    const { el, cmp, fixture } = await mount(fixtureTables());
    cmp.openTopic('a1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('.sheet')).not.toBeNull();
    const worst = deepestBoxNesting(el);
    expect(worst.depth).withContext(`deepest chain: ${worst.path}`).toBeLessThanOrEqual(2);
  });
});

/**
 * THE CARD'S TIME CHIP (admin feedback 9a65a040: "auf einem issue darf das
 * datum gern abgekürzt werden mit heute, gestern, letzte woche, letzten
 * monat, früher… und nur wenn man drüber hovered steht das exakte datum und
 * uhrzeit im entsprechenden Regionsformat").
 *
 * A card is scanned, not read: the age is the answer, and `07 / September /
 * 2026` makes the reader work it out. The exact stamp is not lost — it moves
 * into the chip's tooltip, still in the viewer's own region format.
 *
 * The fixtures are dated off `Date.now()` on purpose. A hard-coded date would
 * quietly change bucket as the calendar moves past it and turn this into a
 * test that fails on a Tuesday in a month's time.
 */
describe('AdminFeedbackComponent — a card states the age, not the calendar', () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it('labels today as today and hides the exact stamp in the tooltip', async () => {
    const created = iso(2 * 3600_000);
    const { el } = await mount({
      admin_feedback: [row('o9', 'open', created)],
      admin_feedback_messages: [],
      feedback_author_messages: [],
    });

    const chip = el.querySelector<HTMLElement>('.scroll.stream .ch-time')!;
    expect(chip).not.toBeNull();
    expect(chip.textContent!.trim()).toBe('date.relative.today');
    // No calendar fields left in the visible label — that was the complaint.
    expect(chip.textContent).not.toContain('2026');

    // …and the full stamp, region-ordered with the clock, one hover away.
    expect(chip.getAttribute('title')).toMatch(/^\d{2} \/ .+ \/ \d{4} · \d{2}:\d{2}$/);
  });

  it('uses the prepositional label where the row reads "waiting since"', async () => {
    // A Rückfrage the routine asked: the baton is with the admin, so the chip
    // says how long he has been sitting on it.
    const asked = iso(26 * 3600_000);
    const { el } = await mount({
      admin_feedback: [row('q9', 'needs_input', asked)],
      admin_feedback_messages: [msg('mq9', 'q9', true, asked, 'Kurze Frage?')],
      feedback_author_messages: [],
    });

    const chip = el.querySelector<HTMLElement>('.scroll.stream .ch-time')!;
    expect(chip.textContent!.trim()).toBe('date.relativeSince.yesterday');
    expect(chip.getAttribute('title')).toMatch(/^\d{2} \/ .+ \/ \d{4} · \d{2}:\d{2}$/);
  });
});

/**
 * MOTION (admin feedback cf74472a: "wenn man in ein issue rein geht und auf
 * abgenommen klickt, sollte man direkt danach wieder in die übersicht
 * zurückkehren und das issue dort sich weg animieren"). The sign-off taken
 * inside a topic closes the sheet FIRST and folds the row out of Du bist dran
 * while the write is on the wire; after the poll the same topic wears the
 * one-time `arrived` glow in Geliefert. Taken on the Geliefert card, nothing
 * moves — the row settles in place. Every one-time highlight is a diff
 * against the previous poll, so the first load highlights nothing.
 */
describe('AdminFeedbackComponent — motion', () => {
  it('sign-off inside the topic: back to the stream, row folds out, arrives in Geliefert', async () => {
    const tables = fixtureTables();
    const { fixture, cmp, el, sb, motion } = await mount(tables);
    expect(cmp.arrived('r1')).withContext('the first load highlights nothing').toBeFalse();

    cmp.openTopic('r1');
    fixture.detectChanges();
    expect(el.querySelector('.sheet.topic')).not.toBeNull();

    // The write will land: the fake table carries the sign-off the poll reads.
    const r1 = { ...(tables.admin_feedback as FeedbackRow[]).find((r) => r.id === 'r1')! };
    (tables.admin_feedback as FeedbackRow[]).find((r) => r.id === 'r1')!.reviewed_at = '2026-09-01T14:00:00Z';
    const accepted = cmp.acceptReview(r1);
    // Before the write even resolves, the sheet is gone and the row folds.
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    fixture.detectChanges();
    expect(cmp.openRow()).withContext('the sheet closes at once').toBeNull();
    expect(el.querySelector('.sheet.topic')).toBeNull();
    await accepted;
    fixture.detectChanges();
    expect(motion.folded).withContext('the Du-bist-dran row folded out').toEqual(['fb-card-r1']);
    expect(sb.updates.map((u) => u.patch)).toEqual([jasmine.objectContaining({ reviewed_at: jasmine.any(String) })]);

    // The poll after the write moved the topic to Geliefert — only that one glows.
    expect(cmp.yourTurn().map((m) => m.id)).not.toContain('r1');
    expect(cmp.arrived('r1')).toBeTrue();
    expect(cmp.bandPulse('nobody')).withContext('the Geliefert count beats once').toBeTrue();
    expect(cmp.bandPulse('admin')).toBeFalse();
    expect(el.querySelector('#fb-card-r1-feed.arrived')).not.toBeNull();
    expect(el.querySelectorAll('.card.arrived').length).toBe(1);
  });

  it('sign-off on the Geliefert card: nothing folds, the row settles in place', async () => {
    const tables = fixtureTables();
    const { fixture, cmp, motion } = await mount(tables);
    const r1 = (tables.admin_feedback as FeedbackRow[]).find((r) => r.id === 'r1')!;

    await cmp.acceptReview(r1);
    fixture.detectChanges();
    expect(motion.folded).toEqual([]);
    expect(cmp.settled('r1')).toBeTrue();
    expect(cmp.openRow()).toBeNull();
  });

  it('a failed sign-off puts the folded row back and shows the error', async () => {
    const tables = fixtureTables();
    const { fixture, cmp, sb, motion } = await mount(tables);
    // The next update fails.
    const client = sb.provider.client as unknown as { from: (t: string) => Record<string, unknown> };
    const from = client.from;
    client.from = (t: string) => {
      const c = from(t);
      if (t === 'admin_feedback') {
        c['update'] = () => ({ eq: () => Promise.resolve({ data: null, error: { message: 'boom' } }) });
      }
      return c;
    };
    cmp.openTopic('r1');
    fixture.detectChanges();
    const r1 = (tables.admin_feedback as FeedbackRow[]).find((r) => r.id === 'r1')!;
    await cmp.acceptReview(r1);
    fixture.detectChanges();
    expect(motion.folded).toEqual(['fb-card-r1']);
    expect(motion.restored).withContext('the row comes back').toEqual(['fb-card-r1']);
    expect(cmp.errorMsg()).toBe('boom');
    expect(cmp.yourTurn().map((m) => m.id)).withContext('still waiting for the sign-off').toContain('r1');
  });

  it('a poll that moves a topic into another band marks it arrived, once', async () => {
    const tables = fixtureTables();
    const { fixture, cmp, el } = await mount(tables);
    expect(el.querySelectorAll('.card.arrived').length).toBe(0);

    // The routine answers o1 with a question: routine's pile → Du bist dran.
    (tables.admin_feedback as FeedbackRow[]).find((r) => r.id === 'o1')!.status = 'needs_input';
    (tables.admin_feedback_messages as FeedbackMessage[]).push(msg('m9', 'o1', true, T('12'), 'Und jetzt?'));
    await cmp.refresh();
    fixture.detectChanges();
    expect(cmp.arrived('o1')).toBeTrue();
    expect(cmp.bandPulse('admin')).toBeTrue();
    expect(cmp.bandPulse('routine')).toBeFalse();
    expect(el.querySelector('#fb-card-o1.arrived')).not.toBeNull();
    // Nothing else moved, nothing else glows.
    expect(el.querySelectorAll('.card.arrived').length).toBe(1);
  });

  it('a brand-new topic arrives in the routine\'s pile', async () => {
    const tables = fixtureTables();
    const { fixture, cmp } = await mount(tables);
    (tables.admin_feedback as FeedbackRow[]).push(row('n1', 'open', T('13')));
    await cmp.refresh();
    fixture.detectChanges();
    expect(cmp.arrived('n1')).toBeTrue();
    expect(cmp.bandPulse('routine')).toBeTrue();
  });

  it('rows carry their index so the rise-in staggers, capped in CSS', async () => {
    const { el } = await mount(fixtureTables());
    const yours = Array.from(el.querySelectorAll<HTMLElement>('.band.yours .card'));
    expect(yours.length).toBeGreaterThan(1);
    yours.forEach((card, i) => expect(card.style.getPropertyValue('--i')).toBe(String(i)));
  });
});
