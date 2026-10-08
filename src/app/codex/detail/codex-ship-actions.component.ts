import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ShipLinkFormStore } from './ship-link-form.store';

/**
 * The rarer ship actions of the codex detail page: class name, add to hangar,
 * the RSI deep link and the "pin your own link" toggle. Shared by the classic
 * tool row and the Holotable drawer (AUD-090, AUD-116).
 *
 * Host is display:contents, so every piece stays an item of the parent's flex
 * row and the row wraps exactly as before; the spacer (classic tool row only)
 * still pushes the actions to the end of that row.
 */
@Component({
  selector: 'sc-codex-ship-actions',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <code class="cls">{{ classNameSlug() }}</code>
    @if (spacer()) {
      <span class="tool-spacer"></span>
    }
    @if (!inHangar()) {
      <button type="button" class="btn add-hangar" (click)="addToHangar.emit()"
              [disabled]="addBusy()" [attr.aria-busy]="addBusy()">
        {{ 'codex.personal.adopt' | translate }}
      </button>
      @if (addFailed()) {
        <p class="err-inline add-err" role="alert">{{ 'codex.card.addToHangarFailed' | translate }}</p>
      }
    }
    <!-- Deep-link out to the official RSI site. We have no reliable
         per-ship RSI slug (our classNameSlug is not the RSI URL slug),
         so without a pinned link this lands on the official ships
         listing rather than 404-ing on a guessed deeplink. A pinned
         value is attacker-controlled, so it is bound with [href] on a
         plain anchor and nothing else: no innerHTML, no LLM prompt. -->
    @if (links.pledgeLink(); as pledge) {
      <a class="btn rsi-link" [href]="pledge" target="_blank" rel="noopener noreferrer nofollow">
        {{ 'codex.detail.viewOnRsi' | translate }} <span aria-hidden="true">↗</span>
      </a>
    } @else {
      <a class="btn rsi-link"
         href="https://robertsspaceindustries.com/en/pledge/ships?sortField=name&sortDirection=asc"
         target="_blank" rel="noopener noreferrer">
        {{ 'codex.detail.viewOnRsi' | translate }} <span aria-hidden="true">↗</span>
      </a>
    }
    @if (auth.user()) {
      <button type="button" class="btn quiet" (click)="links.toggle()">
        {{ (links.myPledgeLink() ? 'codex.shipLink.edit' : 'codex.shipLink.add') | translate }}
      </button>
    }
  `,
  styles: [`
    :host { display: contents; }
    .cls { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); overflow-wrap: anywhere; }
    .tool-spacer { flex: 1 1 auto; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }

    /* The page's button (concept section 2, part-02:159), the .btn half of
       codex-detail's shared .btn/.pin rule. The 48px floor holds for coarse
       pointers (the mobile gate emulates one); a mouse gets the drawn 24px. */
    .btn { position: relative; display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 8px; min-height: 48px;
      border: 1px solid var(--sc-border); border-radius: 3px;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      color: var(--sc-fg-2); font-family: var(--sc-font-display); text-decoration: none;
      font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase;
      cursor: pointer; }
    @media (pointer: fine) {
      .btn { min-height: 24px; }
    }
    .btn:hover { color: var(--sc-fg-0);
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); }
    .btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .btn:disabled { opacity: 0.38; cursor: not-allowed; }
    .btn.quiet { text-transform: none; letter-spacing: 0; background: transparent; }
    .add-hangar { color: var(--sc-accent); }
  `],
})
export class CodexShipActionsComponent {
  protected readonly links = inject(ShipLinkFormStore);
  protected readonly auth = inject(AuthService);

  readonly classNameSlug = input.required<string>();
  /** Classic tool row: a flexible gap pushes the actions to the row's end. */
  readonly spacer = input(false);
  /** Personal mode: the page already shows the reader's variant — no "In dein HQ übernehmen". */
  readonly inHangar = input(false);
  readonly addBusy = input(false);
  readonly addFailed = input(false);
  readonly addToHangar = output<void>();
}
