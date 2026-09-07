import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { FeedbackComposerComponent } from './feedback-composer.component';

/**
 * Every shape the send row is built in, in one host so a single layout pass
 * measures them all: the full "Senden" box, the compact reply used for the
 * Rückfragen channels, and the opened topic's key-cap send button.
 */
@Component({
  standalone: true,
  imports: [FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="v" id="default">
      <sc-feedback-composer placeholder="x" sendLabel="y" />
    </div>
    <div class="v" id="compact">
      <sc-feedback-composer [compact]="true" [frameless]="true" placeholder="x" sendLabel="y" />
    </div>
    <div class="v" id="key">
      <sc-feedback-composer [iconSend]="true" [large]="true" [frameless]="true" placeholder="x" sendLabel="y">
        <button composerAction type="button" class="sc-btn micro">ok</button>
      </sc-feedback-composer>
    </div>
  `,
})
class ActionRowHostComponent {}

/**
 * The composer's send row was three sizes stacked on one line: 36px attachment
 * tiles beside a 37px "Senden", a 30px key-cap send, and — in the Rückfragen
 * boxes — a 22px micro button. Admin feedback af47232a: "die anhänge buttons im
 * feedback panel dürfen ruhig so hoch sein wie der main action button wie z. B.
 * senden … auch bei rückfragen etc."
 *
 * So the height is now ONE declared number (`--sc-composer-action-h`) that the
 * tiles, the send button and the projected sign-off all read, and the guard is
 * that they measure the same — not that they measure 38, which would only
 * re-state the stylesheet.
 *
 * Karma renders at 749px with a fine pointer, i.e. the desktop branch, which is
 * where the row was ragged. The other two branches keep the invariant by
 * construction rather than by a second number: the ≤720px rule only changes the
 * send button's flex, and `(pointer: coarse)` lifts every button in the row to
 * the same `--sc-tap-min` floor.
 */
describe('composer send-row height', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<ActionRowHostComponent>>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ActionRowHostComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(ActionRowHostComponent);
    fixture.detectChanges();
  });

  const heights = (variant: string) => {
    const root = fixture.nativeElement.querySelector(`#${variant}`) as HTMLElement;
    const h = (sel: string) => {
      const el = root.querySelector(sel) as HTMLElement | null;
      expect(el).withContext(`${variant}: ${sel} must exist`).not.toBeNull();
      return Math.round(el!.getBoundingClientRect().height);
    };
    return { send: h('button.send'), add: h('.att-add'), capture: h('.att-capture') };
  };

  for (const variant of ['default', 'compact', 'key']) {
    it(`gives the attach tiles the send button's height (${variant})`, () => {
      const { send, add, capture } = heights(variant);
      expect(add).withContext(`${variant}: "+" tile vs send`).toBe(send);
      expect(capture).withContext(`${variant}: capture tile vs send`).toBe(send);
    });
  }

  it('uses the same band in the reply boxes as in the new-topic box', () => {
    // "auch bei rückfragen etc." — the compact composer is the one the admin
    // names, and it may not be a smaller row than the one next to "Senden".
    expect(heights('compact').send).toBe(heights('default').send);
    expect(heights('key').send).toBe(heights('default').send);
  });

  it('lifts a projected sign-off into the same band', () => {
    const root = fixture.nativeElement.querySelector('#key') as HTMLElement;
    const action = root.querySelector('[composerAction]') as HTMLElement;
    expect(Math.round(action.getBoundingClientRect().height)).toBe(heights('key').send);
  });

  it('leaves the attachment lightbox its own tap size', () => {
    // The strip sits inside the send row, so a rule written as ".foot .sc-btn"
    // would have pulled the lightbox's 48px controls down into the band.
    const styles = (FeedbackComposerComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles;
    expect(styles.join('\n')).not.toMatch(/\.foot\s*\[[^\]]*]\s*\.sc-btn\s*\{/);
  });
});
