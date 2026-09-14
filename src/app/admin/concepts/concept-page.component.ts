import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ConceptPageService, ConceptTicketError, ConceptTicketFailure } from './concept-page.service';

type State = 'loading' | 'ready' | ConceptTicketError;

/**
 * `/konzept/:id` — one hosted concept page, embedded (admin feedback #224).
 *
 * The admin asked for a link on the website that only admins can open and
 * on which the interactive concept (choices, notes, submit) works exactly
 * like the local `/concept` pages — without the local bridge. The route is
 * `roleGuard('admin')`-gated; on top, the `concept-page` edge function
 * refuses to mint a ticket for anyone but an admin, so a leaked route path
 * alone shows nothing.
 *
 * The page itself is served by that function and rendered in an iframe:
 * its own document, its own CSP, its own engine. This component only mints
 * the ticket, frames the document and offers the two navigations (back to
 * the board, open in a new tab). Nothing about the concept's content is
 * rendered here.
 */
@Component({
  selector: 'sc-concept-page',
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="concept">
      <header class="bar">
        <a class="back" routerLink="/admin/feedback">
          <span aria-hidden="true">&larr;</span> {{ 'conceptPage.back' | translate }}
        </a>
        <h1 class="title">{{ title() || ('conceptPage.title' | translate) }}</h1>
        @if (rawUrl(); as href) {
          <a class="open" [href]="href" target="_blank" rel="noopener noreferrer">
            {{ 'conceptPage.openTab' | translate }} <span aria-hidden="true">&nearr;</span>
          </a>
        }
      </header>

      @switch (state()) {
        @case ('loading') {
          <p class="msg" role="status">{{ 'conceptPage.loading' | translate }}</p>
        }
        @case ('forbidden') {
          <p class="msg err" role="alert">{{ 'conceptPage.forbidden' | translate }}</p>
        }
        @case ('notFound') {
          <p class="msg err" role="alert">{{ 'conceptPage.notFound' | translate }}</p>
        }
        @case ('error') {
          <p class="msg err" role="alert">{{ 'conceptPage.error' | translate }}</p>
        }
        @case ('ready') {
          <iframe
            class="frame"
            [src]="safeUrl()"
            [title]="title() || ('conceptPage.title' | translate)"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            referrerpolicy="no-referrer"
          ></iframe>
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .concept {
        display: flex;
        flex-direction: column;
        min-height: calc(100dvh - 4rem);
        width: 100%;
        max-width: 100%;
        overflow-x: hidden;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        padding: 0.5rem 1rem;
        border-bottom: 1px solid var(--sc-border);
        background: var(--sc-bg-1);
      }
      .title {
        flex: 1 1 12rem;
        min-width: 0;
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .back, .open {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        min-height: 2.75rem;
        padding: 0 0.5rem;
        color: var(--sc-accent-hot);
        text-decoration: none;
        white-space: nowrap;
      }
      .back:hover, .open:hover { text-decoration: underline; }
      .msg { padding: 2rem 1rem; text-align: center; color: var(--sc-fg-1); }
      .msg.err { color: var(--sc-danger); }
      .frame {
        flex: 1 1 auto;
        min-height: 70vh;
        width: 100%;
        max-width: 100%;
        border: 0;
        background: transparent;
      }
    `,
  ],
})
export class ConceptPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly tickets = inject(ConceptPageService);

  readonly state = signal<State>('loading');
  readonly title = signal('');
  /** The ticketed document URL — our own function origin, handed to the iframe verbatim. */
  readonly rawUrl = signal<string | null>(null);
  readonly safeUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.rawUrl();
    return url ? this.sanitizer.bypassSecurityTrustResourceUrl(url) : null;
  });

  constructor() {
    this.route.paramMap.subscribe((params) => {
      void this.load(params.get('id') ?? '');
    });
  }

  private async load(id: string): Promise<void> {
    this.state.set('loading');
    this.rawUrl.set(null);
    this.title.set('');
    if (!id) {
      this.state.set('notFound');
      return;
    }
    try {
      const ticket = await this.tickets.mintTicket(id);
      this.title.set(ticket.title);
      this.rawUrl.set(ticket.url);
      this.state.set('ready');
    } catch (err) {
      this.state.set(err instanceof ConceptTicketFailure ? err.kind : 'error');
    }
  }
}
