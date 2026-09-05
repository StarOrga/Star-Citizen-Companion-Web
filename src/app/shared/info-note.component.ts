import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal } from '@angular/core';

/**
 * A small "i" affordance that folds a paragraph of explanation away until it
 * is asked for (admin feedback 01df732d: "Ggf. auch dinge hinter einem info i
 * tooltip verstecken").
 *
 * The projected content is the note; the button is the only thing on screen
 * until someone wants it. Rendered as a real `<button>` because opening the
 * note is an ACTION on this page, not a navigation. The note stays in the DOM
 * and is toggled with `hidden`, so screen readers and the projected content
 * keep their identity across toggles.
 */
@Component({
  selector: 'sc-info-note',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="dot" [attr.aria-label]="label()" [attr.aria-expanded]="open()" (click)="toggle()">
      i
    </button>
    <div class="pop" role="note" [hidden]="!open()">
      <ng-content />
    </div>
  `,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'close()',
  },
  styles: [`
    :host { position: relative; display: inline-flex; }
    .dot {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; padding: 0; border-radius: 50%; cursor: pointer;
      border: 1px solid color-mix(in srgb, var(--sc-fg-2) 55%, transparent);
      background: transparent; color: var(--sc-fg-2);
      font-family: var(--sc-font-display); font-size: max(0.62rem, var(--sc-fs-floor));
      font-weight: 600; line-height: 1;
    }
    .dot:hover, .dot[aria-expanded='true'] { color: var(--sc-accent); border-color: var(--sc-accent); }
    .dot:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .pop {
      position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: max(240px, 18rem);
      padding: 12px 14px; border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-1); box-shadow: 0 12px 30px rgb(0 0 0 / 0.35);
      font-size: max(0.7rem, var(--sc-fs-floor)); line-height: 1.5; color: var(--sc-fg-1);
      text-align: left; white-space: normal;
    }
    @media (max-width: 480px) {
      .pop { width: min(78vw, 18rem); }
    }
  `],
})
export class InfoNoteComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  /** Accessible name of the button — already translated by the caller. */
  readonly label = input.required<string>();

  readonly open = signal(false);

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  /** A click anywhere else dismisses the note — the usual popover contract. */
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const el = this.host.nativeElement as HTMLElement;
    if (!el.contains(event.target as Node)) this.open.set(false);
  }
}
