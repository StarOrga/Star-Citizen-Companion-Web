import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ComposerPrefsService } from '../../core/composer-prefs.service';
import { ComposerPayload, FeedbackComposerComponent } from './feedback-composer.component';

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
    localStorage.setItem('sc.composer.sendOnEnter', sendOnEnter ? '1' : '0');

    await TestBed.configureTestingModule({
      imports: [FeedbackComposerComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
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
