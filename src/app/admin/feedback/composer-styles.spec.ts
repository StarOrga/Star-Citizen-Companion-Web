import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { TestBed } from '@angular/core/testing';
import { REMOVE_STYLES_ON_COMPONENT_DESTROY } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideTranslateService } from '@ngx-translate/core';
import { appConfig } from '../../app.config';
import { FeedbackComposerComponent } from './feedback-composer.component';

/**
 * The board's own shape, reduced to what broke: a composer that lives inside an
 * animated, collapsible card and is destroyed and re-created every time the
 * board refreshes after a send.
 */
@Component({
  standalone: true,
  imports: [FeedbackComposerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('expandCollapse', [
      transition(':enter', [
        style({ height: '0', opacity: 0, overflow: 'hidden' }),
        animate('220ms', style({ height: '*', opacity: 1 })),
      ]),
      transition(':leave', [
        style({ overflow: 'hidden' }),
        animate('180ms', style({ height: '0', opacity: 0 })),
      ]),
    ]),
  ],
  template: `
    @for (id of cards(); track id) {
      @if (open() === id) {
        <div [@expandCollapse]>
          <sc-feedback-composer [compact]="true" placeholder="x" sendLabel="y" />
        </div>
      }
    }
  `,
})
class CardHostComponent {
  readonly cards = signal(['a', 'b', 'c']);
  readonly open = signal<string | null>('a');
}

/**
 * The reply composer came back COMPLETELY UNSTYLED after a message was sent
 * (admin feedback 18e96ad3, screenshot: a native 20-column textarea, native
 * buttons, no card frame) — its component styles were not in effect while a
 * live instance was on screen. Sending runs a board refresh, which tears every
 * composer down and builds it again, and the collapse animation defers part of
 * that teardown past the rebuild.
 *
 * Two guards, because either one alone would pass for the wrong reason:
 * the app must keep component styles for good (the config), and the composer
 * must still be styled after being swapped from card to card (the behaviour).
 */
describe('feedback composer style retention', () => {
  it('keeps component styles in the document for the whole session', () => {
    const provider = appConfig.providers
      .flat(Infinity)
      .find(
        (p): p is { provide: unknown; useValue: unknown } =>
          !!p && typeof p === 'object' && 'provide' in p &&
          (p as { provide: unknown }).provide === REMOVE_STYLES_ON_COMPONENT_DESTROY,
      );
    expect(provider).withContext('REMOVE_STYLES_ON_COMPONENT_DESTROY must be provided').toBeDefined();
    expect(provider!.useValue).toBe(false);
  });

  it('is still styled after the answered card folds away and the next one opens', async () => {
    await TestBed.configureTestingModule({
      imports: [CardHostComponent],
      providers: [
        provideAnimationsAsync(),
        provideTranslateService(),
        { provide: REMOVE_STYLES_ON_COMPONENT_DESTROY, useValue: false },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(CardHostComponent);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 60));
    fixture.detectChanges();

    const swap = async (next: string | null) => {
      // Same tick: fold the answered topic away and open the next one — the
      // motion advanceAfterAnswer performs once a reply is persisted.
      fixture.componentInstance.open.set(next);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 260));
      fixture.detectChanges();
    };

    // Including the "no composer at all" state in between: that is the moment
    // the last instance of the type goes away.
    for (const next of ['b', null, 'c', 'a']) {
      await swap(next);
      const ta = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement | null;
      if (!ta) continue;
      // A styled composer is border-box and fills its column; an unstyled one
      // falls back to the UA's content-box 20-column default.
      expect(getComputedStyle(ta).boxSizing).withContext(`after opening ${next}`).toBe('border-box');
      expect(ta.clientWidth).withContext(`after opening ${next}`).toBeGreaterThan(200);
    }
  });
});
