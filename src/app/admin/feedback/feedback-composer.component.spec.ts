import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { ComposerPrefsService } from '../../core/composer-prefs.service';
import { FeedbackDraftService, DraftEntry } from '../../feedback/feedback-draft.service';
import { DraftImageRef } from '../../feedback/feedback-draft.types';
import { ComposerPayload, FeedbackComposerComponent } from './feedback-composer.component';
import { FEEDBACK_MAX_CHARS } from '../../feedback/feedback-limits';

/**
 * Stand-in for the account-bound draft store: the composer's contract with it is
 * "hand me what is stored, take what I hold, and only remove it when I say so".
 */
class FakeDraftStore {
  readonly map = signal<ReadonlyMap<string, DraftEntry>>(new Map());
  readonly staged: { scope: string; body: string; images: DraftImageRef[] }[] = [];
  readonly flushed: string[] = [];
  readonly discarded: string[] = [];
  readonly cleared: string[] = [];
  uploadUrl: string | null = 'https://db.test/storage/v1/object/public/feedback-images/u/1.jpg';

  readonly entries = this.map.asReadonly();

  seed(scope: string, entry: Partial<DraftEntry>): void {
    const next = new Map(this.map());
    next.set(scope, {
      scope,
      feedbackId: null,
      body: '',
      images: [],
      updatedAt: '2026-07-29T10:00:00Z',
      dirty: false,
      failed: false,
      ...entry,
    });
    this.map.set(next);
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  entry(scope: string): DraftEntry | null {
    return this.map().get(scope) ?? null;
  }

  stage(scope: string, body: string, images: readonly DraftImageRef[]): void {
    this.staged.push({ scope, body, images: [...images] });
  }

  flush(scope: string): Promise<void> {
    this.flushed.push(scope);
    return Promise.resolve();
  }

  discard(scope: string): Promise<void> {
    this.discarded.push(scope);
    const next = new Map(this.map());
    next.delete(scope);
    this.map.set(next);
    return Promise.resolve();
  }

  clearSent(scope: string): Promise<void> {
    this.cleared.push(scope);
    const next = new Map(this.map());
    next.delete(scope);
    this.map.set(next);
    return Promise.resolve();
  }

  uploadAttachment(): Promise<string | null> {
    return Promise.resolve(this.uploadUrl);
  }
}

let drafts: FakeDraftStore;

/**
 * The chat keyboard contract (feedback aa8d5b18): Enter sends by default,
 * Shift+Enter breaks the line and continues an active list, Ctrl/Cmd+Enter
 * still sends — and each user can mirror the mapping in the settings.
 */
describe('FeedbackComposerComponent — Enter sends', () => {
  let fixture: ComponentFixture<FeedbackComposerComponent>;
  let cmp: FeedbackComposerComponent;
  let sent: ComposerPayload[];

  async function setup(draft = 'hello', sendOnEnter = true) {
    sent = [];
    drafts = new FakeDraftStore();
    localStorage.setItem('sc.composer.sendOnEnter', sendOnEnter ? '1' : '0');

    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackDraftService, useValue: drafts },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('placeholder', 'adminFeedback.compose.placeholder');
    fixture.componentRef.setInput('sendLabel', 'adminFeedback.compose.send');
    fixture.componentRef.setInput('onSubmit', (p: ComposerPayload) => {
      sent.push(p);
      return Promise.resolve(true);
    });
    fixture.detectChanges();

    cmp = fixture.componentInstance;
    typeInto(draft);
    return cmp;
  }

  /** Write into the real textarea the way a user would, caret at the end. */
  function typeInto(value: string, caret = value.length): HTMLTextAreaElement {
    const el: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    el.value = value;
    el.setSelectionRange(caret, caret);
    cmp.onInput({ target: el } as unknown as Event);
    fixture.detectChanges();
    return el;
  }

  function press(init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init });
    cmp.onKeydown(e);
    return e;
  }

  afterEach(() => {
    localStorage.removeItem('sc.composer.sendOnEnter');
    TestBed.resetTestingModule();
  });

  it('sends on plain Enter and swallows the newline', async () => {
    await setup('ship it');
    const e = press();
    await fixture.whenStable();

    expect(e.defaultPrevented).toBeTrue();
    expect(sent.map((p) => p.text)).toEqual(['ship it']);
    expect(cmp.draft()).toBe('');
  });

  it('sends on Ctrl+Enter and on Cmd+Enter (muscle memory kept)', async () => {
    await setup('via ctrl');
    press({ ctrlKey: true });
    await fixture.whenStable();
    expect(sent.map((p) => p.text)).toEqual(['via ctrl']);

    typeInto('via cmd');
    press({ metaKey: true });
    await fixture.whenStable();
    expect(sent.map((p) => p.text)).toEqual(['via ctrl', 'via cmd']);
  });

  it('does not send on Shift+Enter — the newline stays with the browser', async () => {
    await setup('line one');
    const e = press({ shiftKey: true });
    await fixture.whenStable();

    expect(e.defaultPrevented).toBeFalse();
    expect(sent).toEqual([]);
    expect(cmp.draft()).toBe('line one');
  });

  it('continues a bullet list on Shift+Enter instead of sending', async () => {
    await setup('- first');
    const e = press({ shiftKey: true });
    await fixture.whenStable();

    expect(sent).toEqual([]);
    expect(e.defaultPrevented).toBeTrue();
    expect(cmp.draft()).toBe('- first\n- ');
  });

  it('continues a numbered list on Shift+Enter and increments the marker', async () => {
    await setup('1. first');
    press({ shiftKey: true });
    await fixture.whenStable();

    expect(sent).toEqual([]);
    expect(cmp.draft()).toBe('1. first\n2. ');
  });

  it('leaves the list when Shift+Enter hits an empty marker line', async () => {
    await setup('- first\n- ');
    press({ shiftKey: true });
    await fixture.whenStable();

    expect(sent).toEqual([]);
    expect(cmp.draft()).toBe('- first\n\n');
  });

  it('never sends an empty or whitespace-only draft', async () => {
    await setup('   \n  ');
    const e = press();
    await fixture.whenStable();

    expect(sent).toEqual([]);
    // Enter is still consumed as "send" — it must not sneak in a newline either.
    expect(e.defaultPrevented).toBeTrue();
  });

  it('ignores Enter while an IME composition is open', async () => {
    await setup('こんにち');
    const e = press({ isComposing: true });
    await fixture.whenStable();

    expect(sent).toEqual([]);
    expect(e.defaultPrevented).toBeFalse();
  });

  describe('with "Enter sendet" turned off', () => {
    it('does not send on plain Enter — the newline stays with the browser', async () => {
      await setup('line one', false);
      const e = press();
      await fixture.whenStable();

      expect(e.defaultPrevented).toBeFalse();
      expect(sent).toEqual([]);
      expect(cmp.draft()).toBe('line one');
    });

    it('still sends on Ctrl/Cmd+Enter', async () => {
      await setup('via ctrl', false);
      press({ ctrlKey: true });
      await fixture.whenStable();
      expect(sent.map((p) => p.text)).toEqual(['via ctrl']);

      typeInto('via cmd');
      press({ metaKey: true });
      await fixture.whenStable();
      expect(sent.map((p) => p.text)).toEqual(['via ctrl', 'via cmd']);
    });

    it('continues a list on plain Enter as well as on Shift+Enter', async () => {
      await setup('- first', false);
      press();
      await fixture.whenStable();
      expect(sent).toEqual([]);
      expect(cmp.draft()).toBe('- first\n- ');

      typeInto('1. first');
      press({ shiftKey: true });
      await fixture.whenStable();
      expect(sent).toEqual([]);
      expect(cmp.draft()).toBe('1. first\n2. ');
    });

    it('names the Ctrl/Cmd mapping in the hint under the field', async () => {
      await setup('anything', false);
      expect(cmp.sendHintKey()).toBe('adminFeedback.compose.sendHintCtrl');

      TestBed.inject(ComposerPrefsService).setSendOnEnter(true);
      expect(cmp.sendHintKey()).toBe('adminFeedback.compose.sendHint');
    });
  });
});

/**
 * Draft persistence: someone wrote a long topic, never pressed send and closed
 * the tab — and it was gone. Everything typed here now lives on the account and
 * only leaves it on a send or an explicit discard.
 */
describe('FeedbackComposerComponent — account-bound drafts', () => {
  let fixture: ComponentFixture<FeedbackComposerComponent>;
  let cmp: FeedbackComposerComponent;
  let sent: ComposerPayload[];

  const SCOPE = 'admin:new';
  const OTHER = 'admin:workflow:0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
  const IMG = 'https://db.test/storage/v1/object/public/feedback-images/u/1.jpg';

  async function mount(scope: string | null = SCOPE, ok = true) {
    sent = [];
    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackDraftService, useValue: drafts },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('draftScope', scope);
    fixture.componentRef.setInput('onSubmit', (p: ComposerPayload) => {
      sent.push(p);
      return Promise.resolve(ok);
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cmp = fixture.componentInstance;
  }

  function type(value: string) {
    const el: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
    el.value = value;
    cmp.onInput({ target: el } as unknown as Event);
    fixture.detectChanges();
  }

  beforeEach(() => {
    drafts = new FakeDraftStore();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('restores text and attachments from the store', async () => {
    drafts.seed(SCOPE, { body: 'the long report', images: [{ id: 'i1', name: 'shot', url: IMG }] });
    await mount();

    expect(cmp.draft()).toBe('the long report');
    expect(cmp.attachments().map((a) => a.url)).toEqual([IMG]);
    expect(cmp.draftRestored()).toBeTrue();
    // The restored image has no local bytes — the bucket URL is what renders.
    expect(cmp.pendingImages().map((i) => i.src)).toEqual([IMG]);
  });

  it('stages every keystroke and flushes on blur', async () => {
    await mount();
    type('half a th');
    type('half a thought');

    expect(drafts.staged.map((s) => s.body)).toEqual(['half a th', 'half a thought']);
    expect(drafts.staged.every((s) => s.scope === SCOPE)).toBeTrue();

    cmp.flushDraft();
    expect(drafts.flushed).toContain(SCOPE);
  });

  it('clears the stored draft after a successful send — and only then', async () => {
    await mount(SCOPE, false);
    type('will not go through');
    await cmp.submit();

    expect(sent.length).toBe(1);
    expect(drafts.cleared).toEqual([]);
    expect(cmp.draft()).toBe('will not go through');
  });

  it('clears the stored draft once the message is persisted', async () => {
    await mount();
    type('this one lands');
    await cmp.submit();

    expect(drafts.cleared).toEqual([SCOPE]);
    expect(cmp.draft()).toBe('');
  });

  it('needs two clicks to discard, and then wipes text, attachments and row', async () => {
    drafts.seed(SCOPE, { body: 'typed', images: [{ id: 'i1', name: 'shot', url: IMG }] });
    await mount();

    cmp.armDiscard();
    expect(cmp.discardArmed()).toBeTrue();
    expect(drafts.discarded).toEqual([]);

    cmp.discardDraft();
    expect(drafts.discarded).toEqual([SCOPE]);
    expect(cmp.draft()).toBe('');
    expect(cmp.attachments()).toEqual([]);
    expect(cmp.hasStoredDraft()).toBeFalse();
  });

  it('hands the old draft back and pulls the new one when the scope moves on', async () => {
    drafts.seed(SCOPE, { body: 'first topic' });
    drafts.seed(OTHER, { body: 'second topic' });
    await mount();
    expect(cmp.draft()).toBe('first topic');

    fixture.componentRef.setInput('draftScope', OTHER);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(drafts.flushed).toContain(SCOPE);
    expect(cmp.draft()).toBe('second topic');
  });

  it('reports the store state in the action row', async () => {
    await mount();
    expect(cmp.draftLabel()).toBeNull();

    drafts.seed(SCOPE, { body: 'x', dirty: true });
    expect(cmp.draftLabel()).toBe('adminFeedback.compose.draftSaving');

    drafts.seed(SCOPE, { body: 'x', dirty: false });
    expect(cmp.draftLabel()).toBe('adminFeedback.compose.draftSaved');

    drafts.seed(SCOPE, { body: 'x', dirty: true, failed: true });
    expect(cmp.draftLabel()).toBe('adminFeedback.compose.draftFailed');
    expect(cmp.draftFailed()).toBeTrue();
  });

  it('persists nothing at all without a scope', async () => {
    await mount(null);
    type('ephemeral');

    expect(drafts.staged).toEqual([]);
    expect(cmp.draftLabel()).toBeNull();
    expect(cmp.hasStoredDraft()).toBeFalse();
  });
});

/**
 * The character cap (admin feedback 0a0fad31). A topic arrived carrying an
 * unbroken run of ~9.800 characters; nothing on the way in said no. Three
 * guards, because `maxlength` alone is not a cap — it covers typing and
 * pasting, but a DROP walks straight past it, and a draft stored before the cap
 * existed can already be over it.
 */
describe('FeedbackComposerComponent — character limit', () => {
  let fixture: ComponentFixture<FeedbackComposerComponent>;
  let cmp: FeedbackComposerComponent;

  async function mount(scope: string | null = 'admin:new') {
    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackDraftService, useValue: drafts },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('draftScope', scope);
    fixture.componentRef.setInput('placeholder', 'adminFeedback.compose.placeholder');
    fixture.componentRef.setInput('sendLabel', 'adminFeedback.compose.send');
    fixture.componentRef.setInput('onSubmit', () => Promise.resolve(true));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cmp = fixture.componentInstance;
  }

  const field = (): HTMLTextAreaElement => fixture.nativeElement.querySelector('textarea');

  /** What a drop does: put the text into the element and fire `input`. */
  function drop(value: string): HTMLTextAreaElement {
    const el = field();
    el.value = value;
    el.setSelectionRange(value.length, value.length);
    cmp.onInput({ target: el } as unknown as Event);
    fixture.detectChanges();
    return el;
  }

  beforeEach(() => {
    drafts = new FakeDraftStore();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('tells the browser the cap through maxlength', async () => {
    await mount();
    expect(field().getAttribute('maxlength')).toBe(String(FEEDBACK_MAX_CHARS));
  });

  it('shows the live count next to the cap, inside the field', async () => {
    await mount();
    drop('hello');
    const counter: HTMLElement = fixture.nativeElement.querySelector('sc-char-counter');
    expect(counter).withContext('counter is rendered').not.toBeNull();
    expect(counter.textContent?.trim()).toBe(`5 / ${FEEDBACK_MAX_CHARS}`);
    // Bottom-right INSIDE the box: the field's wrapper is the positioning
    // context, so the counter can never end up under the send button.
    expect(counter.closest('.field')).withContext('counter lives in the field').not.toBeNull();
    expect(counter.closest('.field')!.querySelector('textarea')).toBe(field());
  });

  it('truncates text dropped past the cap — the 9.800-char wall never lands', async () => {
    await mount();
    const el = drop('a'.repeat(9800));

    expect(cmp.draft().length).toBe(FEEDBACK_MAX_CHARS);
    // …and it is gone from the DOM too, not just from the signal.
    expect(el.value.length).toBe(FEEDBACK_MAX_CHARS);
    expect(cmp.overLimit()).toBeFalse();
    expect(drafts.staged.at(-1)!.body.length).toBe(FEEDBACK_MAX_CHARS);
  });

  it('leaves anything under the cap exactly as typed', async () => {
    await mount();
    const text = 'a'.repeat(FEEDBACK_MAX_CHARS);
    drop(text);
    expect(cmp.draft()).toBe(text);
    expect(cmp.charCount()).toBe(FEEDBACK_MAX_CHARS);
    expect(cmp.canSend()).toBeTrue();
  });

  it('refuses to send a restored draft that is over the cap', async () => {
    // Written before the cap existed: kept, shown, editable — but not sendable.
    drafts.seed('admin:new', { body: 'a'.repeat(FEEDBACK_MAX_CHARS + 1) });
    await mount();

    expect(cmp.draft().length).toBe(FEEDBACK_MAX_CHARS + 1);
    expect(cmp.overLimit()).toBeTrue();
    expect(cmp.canSend()).toBeFalse();

    // One edit through the field is enough to bring it back under the cap.
    drop(cmp.draft());
    expect(cmp.overLimit()).toBeFalse();
    expect(cmp.canSend()).toBeTrue();
  });

  it('caps the list-continuation insert as well', async () => {
    await mount();
    const el = drop(`- ${'a'.repeat(FEEDBACK_MAX_CHARS - 2)}`);
    el.setSelectionRange(el.value.length, el.value.length);

    cmp.onKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, cancelable: true }));
    fixture.detectChanges();

    expect(cmp.draft().length).toBe(FEEDBACK_MAX_CHARS);
    expect(el.value.length).toBe(FEEDBACK_MAX_CHARS);
  });
});
