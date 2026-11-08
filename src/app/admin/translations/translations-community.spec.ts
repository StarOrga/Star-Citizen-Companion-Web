import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { FakeCall, FakeResult, fakeSupabase } from '../../testing/fake-supabase';
import { TranslationAlertsComponent } from './translation-alerts.component';
import { TranslationCardsComponent } from './translation-cards.component';
import { TranslationOutreachComponent } from './translation-outreach.component';
import { TranslationSourcesComponent } from './translation-sources.component';
import { TranslationsService } from './translations.service';
import { canImportSource, contextLines, goalPercent } from './translations.logic';

type Answer = (c: FakeCall) => FakeResult | Promise<FakeResult>;

const card = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  lang: 'de',
  kind: 'meta',
  question: `Frage ${id}`,
  option_a: { text: 'Rumpf', source: 'CIG' },
  option_b: { text: 'Hülle', source: 'rjcncpt' },
  context: { key: 'ui_hull', en: 'Hull', where: 'HUD', neighbours: ['a', { key: 'k', text: 'b' }], research: 'Fund' },
  spread: 40,
  reach: 2,
  doubt: 0.5,
  fresh: false,
  status: 'open',
  answer: null,
  impact: null,
  points: null,
  ...extra,
});

function setup(answer: Answer, userId = 'me') {
  const fake = fakeSupabase({ answer });
  const confirm = jasmine.createSpy('confirm').and.resolveTo(true);
  TestBed.configureTestingModule({
    providers: [
      fake.provider,
      provideTranslateService(),
      provideRouter([]),
      { provide: ScConfirmService, useValue: { confirm } },
      { provide: AuthService, useValue: { realUser: () => ({ id: userId }) } },
    ],
  });
  return { fake, confirm };
}

async function settle(fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) {
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

const q = <T extends Element>(el: HTMLElement, sel: string) => el.querySelector<T>(sel);
describe('logic helpers of the community tabs', () => {
  it('allows import only for licensed and permitted sources', () => {
    expect(canImportSource('licensed')).toBeTrue();
    expect(canImportSource('permitted')).toBeTrue();
    expect(canImportSource('awaiting_permission')).toBeFalse();
    expect(canImportSource('refused')).toBeFalse();
  });

  it('clamps the goal progress and flattens card context', () => {
    expect(goalPercent(5, 10)).toBe(50);
    expect(goalPercent(25, 10)).toBe(100);
    expect(contextLines(['a', { key: 'k', text: 'b' }, { x: 1 }])).toEqual(['a', 'k: b', '{"x":1}']);
  });
});

describe('TranslationCardsComponent', () => {
  const base = (queue: unknown[]): Answer => (c) => {
    if (c.op === 'from' && c.target === 'translation_cards') return { data: queue };
    if (c.target === 'translation_card_stats') return { data: [{ open_count: queue.length, answered_today: 3, streak_days: 2 }] };
    if (c.target === 'translation_card_leaderboard') return { data: [{ answered_by: 'me', points: 120, answers: 9, streak_days: 2 }] };
    if (c.target === 'list_users_for_admin') return { data: [{ id: 'me', display_name: 'Jerry', email: 'j@example.test', protected: true }] };
    return { data: null };
  };

  it('asks the queue in the contract order and shows card, goal, streak and leaderboard', async () => {
    const { fake } = setup(base([card('c1'), card('c2')]));
    const fixture = TestBed.createComponent(TranslationCardsComponent);
    fixture.detectChanges();
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;

    const list = fake.calls.find((c) => c.target === 'translation_cards')!;
    const orders = list.chain.filter(([m]) => m === 'order').map(([, a]) => (a as unknown[])[0]);
    expect(orders).toEqual(['status', 'spread', 'reach', 'kind_rank', 'doubt', 'fresh']);
    expect(q(el, '[data-test=card]')).not.toBeNull();
    expect(el.textContent).toContain('Frage c1');
    expect(el.textContent).toContain('ui_hull');
    expect(el.textContent).toContain('Fund');
    expect(q(el, '[data-test=goal]')).not.toBeNull();
    expect(fixture.componentInstance.goalPct()).toBe(30);
    expect(q(el, '[data-test=leaderboard]')!.textContent).toContain('Jerry');
  });

  it('answers with an option, sends the p_ args and shows impact and points', async () => {
    const answered = card('c1', { status: 'answered', answer: 'a', impact: 42, points: 14 });
    const { fake } = setup((c) => (c.target === 'answer_translation_card' ? { data: answered } : base([card('c1'), card('c2')])(c)));
    const fixture = TestBed.createComponent(TranslationCardsComponent);
    fixture.detectChanges();
    await settle(fixture);
    const cmp = fixture.componentInstance;

    expect(cmp.canSubmit()).toBeFalse();
    cmp.choose('a');
    cmp.note.set('  Hinweis ');
    cmp.saveRule.set(true);
    await cmp.submit();
    fixture.detectChanges();

    const call = fake.calls.find((c) => c.target === 'answer_translation_card')!;
    expect(call.args).toEqual({ p_card_id: 'c1', p_answer: 'a', p_own_text: null, p_note: 'Hinweis', p_save_as_rule: true });
    const res = q<HTMLElement>(fixture.nativeElement, '[data-test=result]')!;
    expect(res).not.toBeNull();
    expect(cmp.result()?.impact).toBe(42);
    expect(cmp.result()?.points).toBe(14);
    expect(cmp.current()?.id).toBe('c2');
  });

  it('needs own text for "both wrong" and sends it', async () => {
    const { fake } = setup((c) => (c.target === 'answer_translation_card' ? { data: card('c1', { status: 'answered', impact: 0, points: 10 }) } : base([card('c1')])(c)));
    const fixture = TestBed.createComponent(TranslationCardsComponent);
    fixture.detectChanges();
    await settle(fixture);
    const cmp = fixture.componentInstance;

    cmp.choose('own');
    expect(cmp.canSubmit()).toBeFalse();
    cmp.ownText.set('  Schiffsrumpf ');
    expect(cmp.canSubmit()).toBeTrue();
    await cmp.submit();

    const call = fake.calls.find((c) => c.target === 'answer_translation_card')!;
    expect(call.args).toEqual(jasmine.objectContaining({ p_answer: 'own', p_own_text: 'Schiffsrumpf', p_save_as_rule: false }));
    expect(cmp.queue().length).toBe(0);
  });

  it('skips a card to the end of the list', async () => {
    const { fake } = setup((c) => (c.target === 'skip_translation_card' ? { data: card('c1', { status: 'skipped' }) } : base([card('c1'), card('c2')])(c)));
    const fixture = TestBed.createComponent(TranslationCardsComponent);
    fixture.detectChanges();
    await settle(fixture);
    await fixture.componentInstance.skip();
    expect(fake.calls.some((c) => c.target === 'skip_translation_card')).toBeTrue();
    expect(fixture.componentInstance.queue().map((x) => x.id)).toEqual(['c2', 'c1']);
  });

  it('shows the positive empty state for an empty queue and an error state with retry on failure', async () => {
    setup(base([]));
    const empty = TestBed.createComponent(TranslationCardsComponent);
    empty.detectChanges();
    await settle(empty);
    expect(q(empty.nativeElement, '[data-test=empty]')).not.toBeNull();
    TestBed.resetTestingModule();

    setup((c) => (c.target === 'translation_cards' ? { error: { message: 'down' } } : base([])(c)));
    const failed = TestBed.createComponent(TranslationCardsComponent);
    failed.detectChanges();
    await settle(failed);
    expect(q(failed.nativeElement, '.state.error')).not.toBeNull();
    expect(q(failed.nativeElement, '[data-test=empty]')).toBeNull();
  });
});

describe('TranslationSourcesComponent', () => {
  const src = (id: string, status: string) => ({
    id,
    lang: id === 'thord82' ? 'es' : 'de',
    name: id,
    license: 'MIT',
    license_kind: 'permissive',
    status,
    enabled: true,
    game_folder: 'german_(germany)',
    last_synced_at: null,
    coverage: { text_pct: 94.3 },
  });
  const answer: Answer = (c) => {
    if (c.target === 'translation_sources') return { data: [src('rjcncpt', 'licensed'), src('thord82', 'awaiting_permission')] };
    if (c.op === 'invoke') {
      const op = (c.args as { body: { op: string } }).body.op;
      if (op === 'import_seed') return { data: { source_id: 'rjcncpt', lang: 'de', imported: 7, skipped_cig: 1, skipped_same: 0, rejected_qa: 0, conflicts: 0, coverage: {} } };
      return { data: { ok: true, checked: 2, changed: 1, errors: 0 } };
    }
    return { data: null };
  };

  it('disables import for sources awaiting permission and imports licensed ones via the orchestrator', async () => {
    const { fake, confirm } = setup(answer);
    const fixture = TestBed.createComponent(TranslationSourcesComponent);
    fixture.detectChanges();
    await settle(fixture);
    const rows = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('table.src tbody tr'));
    expect(rows.length).toBe(2);
    const importBtn = (r: Element) => r.querySelector<HTMLButtonElement>('.tip-wrap button')!;
    expect(importBtn(rows[0]).disabled).toBeFalse();
    expect(importBtn(rows[1]).disabled).toBeTrue();

    const cmp = fixture.componentInstance;
    await cmp.importSeed(cmp.sources()[1]);
    expect(fake.calls.some((c) => c.op === 'invoke')).toBeFalse();

    await cmp.importSeed(cmp.sources()[0]);
    expect(confirm).toHaveBeenCalled();
    const inv = fake.calls.find((c) => c.op === 'invoke')!;
    expect(inv.target).toBe('translate-orchestrator');
    expect((inv.args as { body: unknown }).body).toEqual({ op: 'import_seed', source_id: 'rjcncpt' });
    expect(cmp.summary()?.entries.find((e) => e.k === 'imported')?.v).toBe('7');
  });

  it('syncs all sources after confirmation', async () => {
    const { fake } = setup(answer);
    const fixture = TestBed.createComponent(TranslationSourcesComponent);
    fixture.detectChanges();
    await settle(fixture);
    await fixture.componentInstance.sync();
    const inv = fake.calls.find((c) => c.op === 'invoke')!;
    expect((inv.args as { body: unknown }).body).toEqual({ op: 'sync_sources' });
    expect(fixture.componentInstance.flash()?.params).toEqual({ checked: 2, changed: 1, errors: 0 });
  });
});

describe('TranslationOutreachComponent', () => {
  const draft = (extra: Record<string, unknown> = {}) => ({
    id: 'o1',
    source_id: 'thord82',
    kind: 'permission',
    message_lang: 'de',
    subject: 'Anfrage',
    body: 'Hallo',
    status: 'draft',
    approved_at: null,
    sent_at: null,
    answer: null,
    answer_at: null,
    decision: null,
    created_at: '2026-11-08T10:00:00Z',
    ...extra,
  });
  const make =
    (protectedAdmin: boolean | 'unreadable', extra: Answer = () => ({ data: null })): Answer =>
    (c) => {
      const r = extra(c);
      if (r && (r as FakeResult).data !== null) return r;
      if (c.target === 'translation_outreach' && c.op === 'from') return { data: [draft()] };
      if (c.target === 'translation_sources') return { data: [{ id: 'thord82', name: 'Thord82', lang: 'es', status: 'awaiting_permission', license_kind: 'none' }] };
      if (c.target === 'list_users_for_admin') {
        return protectedAdmin === 'unreadable'
          ? { error: { message: 'x' } }
          : { data: [{ id: 'me', display_name: 'Jerry', email: 'j@example.test', protected: protectedAdmin }] };
      }
      return { data: null };
    };

  it('says that nothing is sent automatically', async () => {
    setup(make(true));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(q(fixture.nativeElement, '[data-test=no-auto-send]')).not.toBeNull();
  });

  it('disables approve for a non-protected admin', async () => {
    setup(make(false));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.componentInstance.approveLocked()).toBeTrue();
    const approve = q<HTMLButtonElement>(fixture.nativeElement, '[data-test=draft] .tip-wrap button')!;
    expect(approve.disabled).toBeTrue();
  });

  it('approves for a protected admin and keeps the button usable', async () => {
    const approved = draft({ status: 'approved' });
    const { fake } = setup(make(true, (c) => (c.target === 'approve_translation_outreach' ? { data: approved } : { data: null })));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    const btn = q<HTMLButtonElement>(fixture.nativeElement, '[data-test=draft] .tip-wrap button')!;
    expect(btn.disabled).toBeFalse();
    await fixture.componentInstance.approve(fixture.componentInstance.items()[0]);
    expect(fake.calls.find((c) => c.target === 'approve_translation_outreach')!.args).toEqual({ p_id: 'o1' });
    expect(fixture.componentInstance.items()[0].status).toBe('approved');
  });

  it('locks the button again when the database refuses with 42501', async () => {
    setup(make('unreadable', (c) => (c.target === 'approve_translation_outreach' ? { error: { code: '42501', message: 'no' } } : { data: null })));
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    expect(fixture.componentInstance.approveLocked()).toBeFalse();
    await fixture.componentInstance.approve(fixture.componentInstance.items()[0]);
    expect(fixture.componentInstance.approveLocked()).toBeTrue();
    expect(fixture.componentInstance.flash()).toEqual({ key: 'admin.translations.outreach.approveLocked', err: true });
    expect(fixture.componentInstance.items()[0].status).toBe('draft');
  });

  it('saves draft edits, marks sent and records an answer through the RPCs', async () => {
    const { fake } = setup(
      make(true, (c) => {
        if (c.target === 'mark_translation_outreach_sent') return { data: draft({ status: 'sent' }) };
        if (c.target === 'record_translation_outreach_answer') return { data: draft({ status: 'answered', decision: 'granted' }) };
        return { data: null };
      }),
    );
    const fixture = TestBed.createComponent(TranslationOutreachComponent);
    fixture.detectChanges();
    await settle(fixture);
    const cmp = fixture.componentInstance;
    const o = cmp.items()[0];

    cmp.patch(o, { subject: 'Neu' });
    expect(cmp.dirty(o)).toBeTrue();
    await cmp.save(o);
    const upd = fake.calls.find((c) => c.target === 'translation_outreach' && c.chain.some(([m]) => m === 'update'))!;
    expect(upd.chain.find(([m]) => m === 'update')![1][0]).toEqual({ subject: 'Neu', body: 'Hallo', message_lang: 'de' });

    await cmp.markSent(cmp.items()[0]);
    expect(fake.calls.find((c) => c.target === 'mark_translation_outreach_sent')!.args).toEqual({ p_id: 'o1' });
    expect(cmp.items()[0].status).toBe('sent');

    cmp.openAnswer(cmp.items()[0]);
    cmp.answerText.set('Ja, gern');
    await cmp.recordAnswer(cmp.items()[0]);
    expect(fake.calls.find((c) => c.target === 'record_translation_outreach_answer')!.args).toEqual({
      p_id: 'o1',
      p_answer: 'Ja, gern',
      p_decision: 'granted',
    });
    expect(cmp.items()[0].status).toBe('answered');
  });
});

describe('TranslationAlertsComponent', () => {
  const alert = {
    id: 'a1',
    lang: 'de',
    key: 'ui_x',
    en_old: 'Old EN',
    en_new: 'New EN',
    cig_old: 'Alt',
    cig_new: 'Neu',
    admin_text: 'Meins',
    status: 'open',
    created_at: '2026-11-08T10:00:00Z',
  };

  it('shows the four-way diff and the admin text, and resolves with keep / edit', async () => {
    const { fake } = setup((c) => (c.target === 'translation_override_alerts' ? { data: [alert] } : { data: alert }));
    const fixture = TestBed.createComponent(TranslationAlertsComponent);
    fixture.detectChanges();
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    const text = q(el, '[data-test=alert]')!.textContent!;
    for (const s of ['Old EN', 'New EN', 'Alt', 'Neu', 'Meins']) expect(text).toContain(s);

    const cmp = fixture.componentInstance;
    cmp.startEdit(alert as never);
    cmp.editText.set(' Besser ');
    await cmp.resolve(alert as never, 'edited');
    const call = fake.calls.find((c) => c.target === 'resolve_override_alert')!;
    expect(call.args).toEqual({ p_alert_id: 'a1', p_resolution: 'edited', p_edited_text: 'Besser' });
    expect(cmp.items().length).toBe(0);
  });

  it('sends keep without edited text and shows an error state with retry on load failure', async () => {
    const { fake } = setup((c) => (c.target === 'translation_override_alerts' ? { data: [alert] } : { data: alert }));
    const fixture = TestBed.createComponent(TranslationAlertsComponent);
    fixture.detectChanges();
    await settle(fixture);
    await fixture.componentInstance.resolve(alert as never, 'kept');
    expect(fake.calls.find((c) => c.target === 'resolve_override_alert')!.args).toEqual({
      p_alert_id: 'a1',
      p_resolution: 'kept',
      p_edited_text: null,
    });
    TestBed.resetTestingModule();

    setup(() => ({ error: { message: 'down' } }));
    const failed = TestBed.createComponent(TranslationAlertsComponent);
    failed.detectChanges();
    await settle(failed);
    expect(q(failed.nativeElement, '.state.error')).not.toBeNull();
    expect(q(failed.nativeElement, '[data-test=empty]')).toBeNull();
  });
});

describe('TranslationsService (community seed)', () => {
  it('reads the stats row whether it arrives as array or object', async () => {
    setup((c) => ({ data: c.target === 'translation_card_stats' ? { open_count: '4', answered_today: 1, streak_days: 0 } : null }));
    const svc = TestBed.inject(TranslationsService);
    expect(await svc.cardStats('de')).toEqual({ open_count: 4, answered_today: 1, streak_days: 0 });
  });
});
