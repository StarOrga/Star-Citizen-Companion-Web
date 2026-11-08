import { ChangeDetectionStrategy, Component, DestroyRef, inject, output, signal } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CodexService, toLang } from '../../codex/codex.service';
import { hitTitle } from '../../codex/search/codex-search-model';
import { SearchWishlistService } from '../../codex/search/search-wishlist.service';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';

/** A thing the reader put on the wishlist from inside the flow. */
export interface WishAdded {
  readonly kind: string;
  readonly className: string;
  readonly name: string;
}

interface Hit extends WishAdded {
  readonly kindKey: string;
}

/** Kinds the cart has a label for (`cart.kind.*`); everything else reads as "Gegenstand". */
const LABELLED = ['ship', 'vehicle', 'upcoming', 'weapon', 'component', 'item', 'blueprint', 'material', 'ammunition'];

/**
 * `<sc-hq-wish-search>`: the wishlist's own search inside "Neuer Nachschub" / "Bearbeiten" — a Codex search whose hits
 * go onto the wishlist in place, so the reader never has to leave the flow (and lose its picks) to add one more thing.
 * Emits every added hit; the flow ticks it at once.
 */
@Component({
  selector: 'sc-hq-wish-search',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ws">
      <label class="field">
        <span>{{ 'hq.flow.search.label' | translate }}</span>
        <input type="search" autocomplete="off" maxlength="80" [value]="term()" [placeholder]="'hq.flow.search.placeholder' | translate"
               (input)="onInput($any($event.target).value)" aria-describedby="ws-msg" />
      </label>
      <p id="ws-msg" class="msg" role="status">
        @if (error(); as k) {
          <span class="err">{{ k | translate }}</span>
        } @else if (searching()) {
          {{ 'hq.flow.search.searching' | translate }}
        } @else if (answered() && !hits().length) {
          {{ 'hq.flow.search.none' | translate }}
        }
      </p>
      @if (hits().length) {
        <ul class="list" [attr.aria-label]="'hq.flow.search.results' | translate">
          @for (h of hits(); track h.kind + ':' + h.className) {
            <li>
              <span class="nm">{{ h.name }} <small>{{ ('cart.kind.' + h.kindKey) | translate }}</small></span>
              @if (wish.has(h.kind, h.className, h.name)) {
                <span class="have">{{ 'hq.flow.search.onList' | translate }}</span>
              } @else {
                <button type="button" scAction tier="secondary" [busy]="adding() === h.className" [disabled]="adding() !== null"
                        [attr.aria-label]="'hq.flow.search.addAria' | translate: { name: h.name }" (click)="add(h)">
                  {{ 'hq.flow.search.add' | translate }}
                </button>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: [
    `
      .ws { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); }
      .field { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); max-width: 460px; }
      .field span { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor, 0.75rem)); }
      .field input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; }
      .field input:hover { border-color: var(--sc-accent); }
      .field input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .msg { margin: 0; min-height: 1.2em; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor, 0.75rem)); }
      .msg:empty { min-height: 0; }
      .err { color: var(--sc-warning); }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; max-width: 640px; }
      .list li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: 4px 4px 4px 10px; border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
      .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .nm small { margin-left: 6px; color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor, 0.75rem)); }
      .have { padding-right: 8px; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor, 0.75rem)); }
      @media (pointer: coarse) { .field input { min-height: 48px; } }
    `,
  ],
})
export class HqWishSearchComponent {
  private readonly codex = inject(CodexService);
  private readonly translate = inject(TranslateService);
  protected readonly wish = inject(SearchWishlistService);

  readonly added = output<WishAdded>();

  protected readonly term = signal('');
  protected readonly hits = signal<readonly Hit[]>([]);
  protected readonly searching = signal(false);
  protected readonly answered = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly adding = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor() {
    this.wish.ensureLoaded();
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  protected onInput(v: string): void {
    this.term.set(v);
    this.error.set(null);
    this.answered.set(false);
    if (this.timer) clearTimeout(this.timer);
    const seq = ++this.seq;
    const t = v.trim();
    if (t.length < 2) {
      this.hits.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.timer = setTimeout(() => void this.search(t, seq), 220);
  }

  private async search(t: string, seq: number): Promise<void> {
    try {
      const res = await this.codex.searchAll(t, 4);
      if (seq !== this.seq) return;
      const lang = toLang(this.translate.getCurrentLang() ?? this.translate.getFallbackLang());
      const seen = new Set<string>();
      const out: Hit[] = [];
      for (const h of res.hits) {
        const key = `${h.kind}:${(h.classNameSlug ?? '').toLowerCase()}`;
        if (!h.classNameSlug || seen.has(key)) continue;
        seen.add(key);
        out.push({ kind: h.kind, className: h.classNameSlug, name: hitTitle(h, lang), kindKey: LABELLED.includes(h.kind) ? h.kind : 'item' });
        if (out.length >= 10) break;
      }
      this.hits.set(out);
      this.answered.set(true);
    } catch (err) {
      if (seq !== this.seq) return;
      this.hits.set([]);
      this.error.set(toErrorKey('hq', 'wishSearch', err));
    } finally {
      if (seq === this.seq) this.searching.set(false);
    }
  }

  protected async add(h: Hit): Promise<void> {
    if (this.adding()) return;
    this.adding.set(h.className);
    try {
      const ok = await this.wish.add(h.kind, h.className, h.name);
      if (ok) this.added.emit({ kind: h.kind, className: h.className, name: h.name });
      else this.error.set('hq.flow.search.addFailed');
    } catch (err) {
      this.error.set(toErrorKey('hq', 'wishAdd', err));
    } finally {
      this.adding.set(null);
    }
  }
}
