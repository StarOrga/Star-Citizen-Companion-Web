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
import { PanelNavigationService } from '../../feedback/panel-navigation.service';
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

    const gate = el.querySelector<HTMLElement>('.card.lead .card-inline .review-gate')!;
    expect(gate).not.toBeNull();
    expect(gate.classList.contains('inline')).toBeTrue();
    expect(gate.classList.contains('sc-nest')).toBeFalse();

    // Assert the frame the admin sees, not the class that is supposed to remove
    // it: a global `.sc-nest` rule or a later `.review-gate` declaration can
    // paint a border back on without this markup changing a character. Round 2
    // of a398fc94 was spent answering "is the box still there?" by hand.
    const frame = getComputedStyle(gate);
    for (const side of [frame.borderTopWidth, frame.borderRightWidth, frame.borderBottomWidth, frame.borderLeftWidth]) {
      expect(side).toBe('0px');
    }
    expect(frame.paddingLeft).toBe('0px');

    const labels = Array.from(gate.querySelectorAll('button, a')).map((b) => b.textContent?.trim() ?? '');
    expect(labels.some((l) => l.includes('adminFeedback.actions.viewInApp'))).toBeTrue();
    expect(labels.some((l) => l.includes('adminFeedback.stream.openTopic'))).toBeTrue();
    expect(labels.some((l) => l.includes('adminFeedback.review.accept'))).toBeTrue();
    expect(labels.some((l) => l.includes('adminFeedback.review.reopen'))).toBeFalse();

    // The reopen lives in the topic — as the reply itself, not as a button.
    expect(el.querySelector('.card.lead ~ .inline-actions')).toBeNull();
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
      host.appendChild(el);
    }
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
