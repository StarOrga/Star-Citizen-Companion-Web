import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { renderFeedbackBody } from '../admin/feedback/markdown.util';
import { FEEDBACK_LONG_WORD_CHARS } from './feedback-limits';

/**
 * The reading half of admin feedback 0a0fad31, measured in a real browser
 * rather than asserted from the source.
 *
 * Two halves have to meet for this to work, and each fails silently on its own:
 * `renderFeedbackBody` marks the runaway token, and the GLOBAL `.sc-longword`
 * rule takes it out of the wrapping algorithm. Global is load-bearing — the span
 * arrives through `[innerHTML]`, which never carries Angular's `_ngcontent`
 * attribute, so the day somebody tidies that rule into a component stylesheet it
 * would stop matching with nothing else to show for it. The computed-style
 * expectation below is what would catch that.
 *
 * The frame is 375px because that is the viewport the topic blew up on.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame">
      <div class="body" [innerHTML]="html()"></div>
    </div>
  `,
  styles: [`
    /* Stand-in for the phone viewport: it must NOT be widened by its content. */
    .frame { width: 375px; }
    /* The same two declarations every feedback body surface carries. */
    .body { overflow-wrap: anywhere; overflow-x: auto; font-size: 14px; }
  `],
})
class BodyHostComponent {
  readonly html = input('');
}

describe('runaway feedback text at 375px', () => {
  async function render(body: string) {
    await TestBed.configureTestingModule({ imports: [BodyHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(BodyHostComponent);
    fixture.componentRef.setInput('html', renderFeedbackBody(body).html);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      frame: root.querySelector('.frame') as HTMLElement,
      bodyEl: root.querySelector('.body') as HTMLElement,
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('keeps a 9.800-character run on one line and scrolls it inside its own box', async () => {
    const { frame, bodyEl } = await render('a'.repeat(9800));

    const span = bodyEl.querySelector('span.sc-longword') as HTMLElement | null;
    expect(span).withContext('the runaway token is marked').not.toBeNull();
    expect(getComputedStyle(span!).whiteSpace)
      .withContext('the GLOBAL .sc-longword rule reaches innerHTML content')
      .toBe('nowrap');

    // One line, not two hundred — an inline box that wrapped would report one
    // client rect per line it occupies.
    expect(span!.getClientRects().length).toBe(1);
    // …the overflow goes sideways, inside the body box…
    expect(bodyEl.scrollWidth).toBeGreaterThan(bodyEl.clientWidth);
    // …and the 375px frame around it is not one pixel wider for it.
    expect(frame.clientWidth).toBe(375);
    expect(frame.scrollWidth).toBe(frame.clientWidth);
  });

  it('leaves ordinary prose wrapping exactly as it did', async () => {
    const prose = `${'wort '.repeat(80)}und ein normaler Satz dazu`;
    const { frame, bodyEl } = await render(prose);

    expect(bodyEl.querySelector('span.sc-longword')).toBeNull();
    expect(bodyEl.scrollWidth).withContext('no sideways scroll for prose').toBe(bodyEl.clientWidth);
    expect(bodyEl.clientHeight).withContext('prose still wraps onto many lines').toBeGreaterThan(40);
    expect(frame.scrollWidth).toBe(frame.clientWidth);
  });

  it('still breaks a merely long token mid-word, below the threshold', async () => {
    const { frame, bodyEl } = await render('b'.repeat(FEEDBACK_LONG_WORD_CHARS - 1));

    expect(bodyEl.querySelector('span.sc-longword')).toBeNull();
    // overflow-wrap: anywhere is untouched for everything under the threshold.
    expect(bodyEl.scrollWidth).toBe(bodyEl.clientWidth);
    expect(frame.scrollWidth).toBe(frame.clientWidth);
  });
});
