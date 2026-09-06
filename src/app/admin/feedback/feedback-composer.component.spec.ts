import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ComposerPrefsService } from '../../core/composer-prefs.service';
import { FeedbackDraftService, DraftEntry } from '../../feedback/feedback-draft.service';
import { DraftImageRef } from '../../feedback/feedback-draft.types';
import { PageScreenshotService } from '../../feedback/page-screenshot.service';
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

    it('names the Ctrl/Cmd mapping in the send button tooltip', async () => {
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

  it('shows the live count on a line of its own UNDER the field', async () => {
    await mount();
    drop('hello');
    const counter: HTMLElement = fixture.nativeElement.querySelector('sc-char-counter');
    expect(counter).withContext('counter is rendered').not.toBeNull();
    expect(counter.textContent?.trim()).toBe(`5 / ${FEEDBACK_MAX_CHARS}`);
    // Same block as the field, but below it in normal flow (admin feedback
    // d08f1983: "immer sichtbar, aber darunter und nicht abgeschnitten"). It
    // used to be an overlay pinned inside the box - which is exactly what a box
    // that changes height, inside a panel that scrolls, ends up clipping.
    const block = counter.closest('.field');
    expect(block).withContext('counter lives in the field block').not.toBeNull();
    expect(block!.querySelector('textarea')).toBe(field());
    expect(getComputedStyle(counter).position).withContext('in flow, not pinned').toBe('static');
  });

  it('renders the count from the very first empty field, not only near the cap', async () => {
    await mount();
    const counter: HTMLElement = fixture.nativeElement.querySelector('sc-char-counter');
    expect(counter.textContent?.trim()).toBe(`0 / ${FEEDBACK_MAX_CHARS}`);
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

/**
 * Attachments (admin feedback 312a4acc): who may attach what, where the "add"
 * control lives, and what a page capture turns into.
 */
describe('FeedbackComposerComponent — attachments', () => {
  let fixture: ComponentFixture<FeedbackComposerComponent>;
  let cmp: FeedbackComposerComponent;
  let screenshots: FakeScreenshots;

  class FakeScreenshots {
    readonly busy = signal(false);
    result: File | null = null;
    error: Error | null = null;
    calls = 0;

    async capture(): Promise<File> {
      this.calls++;
      if (this.error) throw this.error;
      return this.result ?? (await imageFile('screenshot.png'));
    }
  }

  /**
   * A real, browser-produced PNG. Deliberately not a hand-typed base64 literal:
   * one of those decodes in an <img> even with a byte out of place and then
   * fails in createImageBitmap, which is what the composer decodes with.
   */
  async function imageFile(name = 'shot.png'): Promise<File> {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context in this browser');
    ctx.fillStyle = '#3366ff';
    ctx.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    return new File([blob], name, { type: 'image/png' });
  }

  function textFile(name = 'crash.log'): File {
    return new File(['boom'], name, { type: 'text/plain' });
  }

  async function mount(allowFiles = false) {
    drafts = new FakeDraftStore();
    screenshots = new FakeScreenshots();
    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackDraftService, useValue: drafts },
        { provide: PageScreenshotService, useValue: screenshots },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('draftScope', 'admin:new');
    fixture.componentRef.setInput('allowFiles', allowFiles);
    fixture.componentRef.setInput('onSubmit', () => Promise.resolve(true));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cmp = fixture.componentInstance;
  }

  /** Feed files in the way the picker does, then wait for the async processing. */
  function pick(...files: File[]): void {
    cmp.onFileInput({ target: { files, value: '' } } as unknown as Event);
  }

  async function until(check: () => boolean, label: string): Promise<void> {
    const started = Date.now();
    while (!check()) {
      if (Date.now() - started > 3000) {
        throw new Error(`timed out waiting for ${label} (error: ${cmp.errorMsg()})`);
      }
      await new Promise((r) => setTimeout(r, 10));
      fixture.detectChanges();
    }
  }

  afterEach(() => TestBed.resetTestingModule());

  it('replaced the mini icon button with a "+" tile inside the attachment row', async () => {
    await mount();
    // The old control is gone for good — this is the whole point of the item.
    expect(fixture.nativeElement.querySelector('button.attach')).toBeNull();
    expect(fixture.nativeElement.querySelector('.att-add')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.att-capture')).not.toBeNull();
  });

  it('restricts the picker to images unless files are allowed', async () => {
    await mount(false);
    const input = fixture.nativeElement.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/*');

    fixture.componentRef.setInput('allowFiles', true);
    fixture.detectChanges();
    expect(input.getAttribute('accept')).toBeNull();
  });

  // The "what you may attach" hint under the field is gone (feedback d08f1983):
  // the attachment row itself already shows a "+" tile and a capture tile, and
  // pasting is universal. What may be attached is enforced by the picker's
  // `accept` (covered by the test above) and by the refusal message below.

  it('keeps the field free of an explainer line', async () => {
    await mount(false);
    expect(fixture.nativeElement.querySelector('.foot .hint')).toBeNull();
  });

  it('refuses a non-image with a sentence when files are not allowed', async () => {
    await mount(false);
    pick(textFile());
    await until(() => cmp.errorMsg() !== null, 'the refusal');
    expect(cmp.attachments().length).toBe(0);
    expect(cmp.errorMsg()).toBe('adminFeedback.compose.imagesOnly');
  });

  it('keeps taking images from a viewer', async () => {
    await mount(false);
    pick(await imageFile());
    await until(() => cmp.attachments().length === 1, 'the image');
    expect(cmp.errorMsg()).toBeNull();
    expect(cmp.pendingImages()[0].kind).toBe('image');
  });

  it('accepts an arbitrary file on an admin composer and chips it as a file', async () => {
    await mount(true);
    pick(textFile());
    await until(() => cmp.attachments().length === 1, 'the file');
    const att = cmp.attachments()[0];
    expect(att.name).toBe('crash.log');
    expect(att.mime).toBe('text/plain');
    // The bytes ride along untouched — a log must not go through the JPEG
    // re-encoder that images do.
    expect(att.file instanceof File).toBeTrue();
    expect(att.dataUrl).toBe('');
    expect(cmp.pendingImages()[0].kind).toBe('file');
  });

  it('refuses a file past the bucket ceiling before it is uploaded', async () => {
    await mount(true);
    const big = new File([new Uint8Array(6 * 1024 * 1024)], 'dump.bin', {
      type: 'application/octet-stream',
    });
    pick(big);
    await until(() => cmp.errorMsg() !== null, 'the size refusal');
    expect(cmp.attachments().length).toBe(0);
  });

  it('turns a page capture into an ordinary image attachment', async () => {
    await mount(false);
    await cmp.captureScreenshot();
    await until(() => cmp.attachments().length === 1, 'the screenshot');

    expect(screenshots.calls).toBe(1);
    const att = cmp.attachments()[0];
    expect(att.name).toBe('screenshot.png');
    // Re-encoded like everything else, so one path handles every image.
    expect(att.dataUrl.startsWith('data:image/jpeg')).toBeTrue();
    expect(cmp.pendingImages()[0].kind).toBe('image');
  });

  it('says so when the capture fails instead of attaching nothing silently', async () => {
    await mount(false);
    screenshots.error = new Error('nope');
    await cmp.captureScreenshot();
    expect(cmp.attachments().length).toBe(0);
    expect(cmp.errorMsg()).toBe('adminFeedback.compose.captureError');
  });

  it('replaces the image with its marked-up version and re-uploads it', async () => {
    await mount(false);
    pick(await imageFile());
    await until(() => cmp.attachments().length === 1, 'the image');
    await until(() => !!cmp.attachments()[0].url, 'the cached upload');

    const id = cmp.attachments()[0].id;
    cmp.onAnnotated({ index: 0, dataUrl: 'data:image/jpeg;base64,QUJD' });

    const marked = cmp.attachments()[0];
    expect(marked.id).withContext('same chip, new bytes').toBe(id);
    expect(marked.dataUrl).toBe('data:image/jpeg;base64,QUJD');
    // The cached object described the UNMARKED image, so its URL cannot stand.
    expect(cmp.attachments().length).toBe(1);
    await until(() => !!cmp.attachments()[0].url, 'the re-upload');
  });

  it('ignores an annotation for a chip that is no longer there', async () => {
    await mount(false);
    expect(() => cmp.onAnnotated({ index: 3, dataUrl: 'data:image/jpeg;base64,QUJD' })).not.toThrow();
    expect(cmp.attachments().length).toBe(0);
  });
});

/**
 * The box the admin actually writes in (admin feedback d08f1983): "sollte drei
 * zeilen haben und sich einfach vertikal ausbauen mit jeder zeile".
 *
 * Both surfaces - the new-topic box and the compact reply box - start at the
 * same three rows and grow from there; growth is capped so a long message
 * cannot push the send button off a phone screen, and past the cap the box
 * scrolls inside itself instead of clipping the text.
 *
 * The growing is CSS (a hidden replica sizes one grid cell), so these are
 * layout assertions on a really rendered component, not signal assertions.
 */
describe('FeedbackComposerComponent - a field that grows with what is typed', () => {
  let fixture: ComponentFixture<FeedbackComposerComponent>;
  let cmp: FeedbackComposerComponent;
  let host: HTMLElement;

  async function mount(compact: boolean, width = '420px'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackDraftService, useValue: new FakeDraftStore() },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('compact', compact);
    fixture.componentRef.setInput('placeholder', 'adminFeedback.compose.placeholder');
    fixture.componentRef.setInput('sendLabel', 'adminFeedback.compose.send');
    fixture.componentRef.setInput('onSubmit', () => Promise.resolve(true));
    // A real column to lay out in - the detached fixture host has no width.
    host = fixture.nativeElement as HTMLElement;
    host.style.width = width;
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    cmp = fixture.componentInstance;
  }

  const ta = (): HTMLTextAreaElement => host.querySelector('textarea')!;

  function type(value: string): void {
    const el = ta();
    el.value = value;
    el.setSelectionRange(value.length, value.length);
    cmp.onInput({ target: el } as unknown as Event);
    fixture.detectChanges();
  }

  /** One rendered line of the field, from its own metrics. */
  function lineHeight(): number {
    const cs = getComputedStyle(ta());
    return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  }

  /** Vertical padding of the field, which is not typing room. */
  function padding(): number {
    const cs = getComputedStyle(ta());
    return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  }

  afterEach(() => {
    host?.remove();
    TestBed.resetTestingModule();
  });

  for (const compact of [false, true]) {
    const name = compact ? 'the reply box' : 'the new-topic box';

    it('opens ' + name + ' at three rows', async () => {
      await mount(compact);
      const rows = (ta().clientHeight - padding()) / lineHeight();
      expect(rows).withContext(name + ': visible rows while empty').toBeGreaterThan(2.6);
      expect(rows).withContext(name + ': visible rows while empty').toBeLessThan(3.6);
    });

    it('grows ' + name + ' by a row per added line', async () => {
      await mount(compact);
      const start = ta().clientHeight;
      type('one\ntwo\nthree\nfour');
      const four = ta().clientHeight;
      expect(four).withContext(name + ': a fourth line makes it taller').toBeGreaterThan(start);
      expect(four - start)
        .withContext(name + ': one line, not a jump')
        .toBeLessThan(lineHeight() * 2);

      type('one\ntwo\nthree\nfour\nfive\nsix');
      expect(ta().clientHeight).withContext(name + ': keeps growing').toBeGreaterThan(four);
    });

    it('stops ' + name + ' growing and scrolls instead once it is long', async () => {
      await mount(compact);
      type(Array.from({ length: 80 }, (_, i) => 'line ' + i).join('\n'));
      const el = ta();
      expect(el.clientHeight).withContext(name + ': capped').toBeLessThan(500);
      expect(el.scrollHeight)
        .withContext(name + ': the text is still all there')
        .toBeGreaterThan(el.clientHeight);
      // Scrollable, not clipped: the caret can always be brought back into view.
      expect(getComputedStyle(el).overflowY).toBe('auto');
    });

    it('keeps the counter visible under ' + name + ' however long the text is', async () => {
      await mount(compact);
      type(Array.from({ length: 80 }, (_, i) => 'line ' + i).join('\n'));
      const counter = host.querySelector('sc-char-counter') as HTMLElement;
      const box = counter.getBoundingClientRect();
      expect(box.height).withContext(name + ': counter has a box').toBeGreaterThan(0);
      expect(box.top)
        .withContext(name + ': below the field')
        .toBeGreaterThanOrEqual(ta().getBoundingClientRect().bottom - 1);
      // Inside the composer's own frame, so no ancestor overflow can eat it.
      const frame = (host.querySelector('.composer') as HTMLElement).getBoundingClientRect();
      expect(box.bottom)
        .withContext(name + ': inside the composer frame')
        .toBeLessThanOrEqual(frame.bottom + 1);
    });

    it('keeps ' + name + ' whole on a 375px phone', async () => {
      // The narrowest viewport the board is used on, minus the panel's own
      // padding: the readout must still be inside the frame on every side,
      // not pushed past the right edge or under the send row.
      await mount(compact, '339px');
      type('a sentence long enough to wrap more than once on a phone screen');
      const counter = host.querySelector('sc-char-counter') as HTMLElement;
      const box = counter.getBoundingClientRect();
      const frame = (host.querySelector('.composer') as HTMLElement).getBoundingClientRect();
      expect(box.width).withContext(name + ': counter is rendered').toBeGreaterThan(0);
      expect(box.right).withContext(name + ': not past the right edge').toBeLessThanOrEqual(
        frame.right + 1,
      );
      expect(box.left).withContext(name + ': not past the left edge').toBeGreaterThanOrEqual(
        frame.left - 1,
      );
      const foot = (host.querySelector('.foot') as HTMLElement).getBoundingClientRect();
      expect(box.bottom)
        .withContext(name + ': above the send row, not under it')
        .toBeLessThanOrEqual(foot.top + 1);
    });
  }
});

/**
 * THE SEND ROW (admin feedback 187574ed).
 *
 * The box used to spend three bands on everything that is not writing: a draft
 * line ABOVE the field, a band of 72px thumbnails under it, and a row that held
 * nothing but the send button. On the opened topic's sheet that added up to
 * more screen than the thread it belongs to.
 *
 * One row now: chips on the left, draft state and the button on the right. The
 * assertions are geometric on purpose — "does not take room above the field" is
 * a measurement, and a stylesheet is the only place it can go wrong.
 */
describe('FeedbackComposerComponent - the send row', () => {
  let fixture: ComponentFixture<FeedbackComposerComponent>;
  let host: HTMLElement;

  async function mount(inputs: Record<string, unknown> = {}, storedDraft = false): Promise<void> {
    const store = new FakeDraftStore();
    if (storedDraft) store.seed('sheet:t1', { body: 'half a thought' });

    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: FeedbackDraftService, useValue: store },
      ],
    }).compileComponents();

    // Real sentences for the keys under test — an uninterpolated placeholder is
    // exactly the failure the last case here is looking for.
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      adminFeedback: {
        compose: { placeholder: 'What could be better?', draftRestored: 'Draft restored' },
        thread: { reply: 'Reply', replyPlaceholderNo: 'Reply to #{{no}} - "{{title}}"' },
      },
    });
    translate.use('en');

    fixture = TestBed.createComponent(FeedbackComposerComponent);
    fixture.componentRef.setInput('placeholder', 'adminFeedback.compose.placeholder');
    fixture.componentRef.setInput('sendLabel', 'adminFeedback.thread.reply');
    if (storedDraft) fixture.componentRef.setInput('draftScope', 'sheet:t1');
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    host = fixture.nativeElement as HTMLElement;
    host.style.width = '420px';
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const q = (sel: string): HTMLElement | null => host.querySelector(sel);
  const box = (sel: string): DOMRect => q(sel)!.getBoundingClientRect();

  afterEach(() => {
    host?.remove();
    TestBed.resetTestingModule();
  });

  it('carries the attachment chips and the send button on ONE line', async () => {
    await mount();
    const row = q('.foot .att-row');
    expect(row).withContext('the chips live in the send row').not.toBeNull();

    const chips = box('.foot .att-row');
    const send = box('.foot .send');
    // Left of the button, not above it - in both media branches, because the
    // row never turns into a column any more.
    expect(chips.right).withContext('chips end before the button starts').toBeLessThanOrEqual(
      send.left + 1,
    );
    expect(Math.abs(chips.top - send.top))
      .withContext('same line')
      .toBeLessThan(Math.max(chips.height, send.height));
  });

  it('leaves nothing at all above the field - the draft notice included', async () => {
    await mount({}, true);
    const flag = q('.draft-flag');
    expect(flag).withContext('a restored draft still says so').not.toBeNull();
    expect(q('.draft-clear')).withContext('and can still be discarded').not.toBeNull();

    const field = box('textarea');
    // The notice is BELOW the writing room, on the send row.
    expect(box('.draft-flag').top)
      .withContext('draft state sits under the field, not over it')
      .toBeGreaterThanOrEqual(field.bottom - 1);
    expect(q('.draft-flag')!.closest('.foot')).withContext('on the send row').not.toBeNull();

    // Nothing between the top of the box and the field but the box's own padding.
    const frame = box('.composer');
    const padTop = parseFloat(getComputedStyle(q('.composer')!).paddingTop);
    expect(field.top - frame.top)
      .withContext('the field opens the box')
      .toBeLessThanOrEqual(padTop + 2);
  });

  it('drops its own frame where the surface around it already draws one', async () => {
    await mount({ frameless: true });
    const cs = getComputedStyle(q('.composer')!);
    expect(cs.borderTopWidth).withContext('no second border').toBe('0px');
    expect(parseFloat(cs.paddingTop)).withContext('no second padding').toBe(0);
    // The field itself keeps its border - that one says "type here".
    expect(getComputedStyle(q('textarea')!).borderTopWidth).not.toBe('0px');
  });

  it('keeps its frame where it is a surface of its own', async () => {
    await mount();
    expect(parseFloat(getComputedStyle(q('.composer')!).borderTopWidth)).toBeGreaterThan(0);
  });

  it('names the topic a reply will land in', async () => {
    await mount({
      placeholder: 'adminFeedback.thread.replyPlaceholderNo',
      placeholderParams: { no: 211, title: 'the composer is too tall' },
    });
    const ta = q('textarea') as HTMLTextAreaElement;
    // Interpolated, not the raw key and not an unresolved {{no}}.
    expect(ta.placeholder).toContain('211');
    expect(ta.placeholder).toContain('the composer is too tall');
    expect(ta.getAttribute('aria-label')).toBe(ta.placeholder);
  });
});
