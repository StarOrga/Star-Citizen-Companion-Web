import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { CodexService, toLang } from '../../codex/codex.service';
import { hitTitle } from '../../codex/search/codex-search-model';
import { toErrorKey } from '../../core/describe-error';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { HQ_DIALOG_STYLES } from '../plan/hq-dialog.styles';

/** A blueprint the reader picked from the Codex: its class name (the Sammlung key) and its shown name. */
export interface PickedBlueprint {
  readonly className: string;
  readonly name: string;
}

/**
 * "Blaupause anlegen": a blueprint is chosen from the Codex catalogue, never typed freely, so the Sammlung entry
 * carries the real class name (its tile links to the blueprint page, the Material path finds it). Blueprints the
 * reader already has are shown but not offered again.
 */
@Component({
  selector: 'sc-hq-blueprint-picker',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit()" aria-labelledby="bp-pick-title">
        <header class="dlg-head">
          <span class="dlg-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 4v16" /></svg></span>
          <h2 id="bp-pick-title" class="dlg-title">{{ 'hq.bestand.addBlueprint' | translate }}<small>{{ 'hq.bestand.bpPick.hint' | translate }}</small></h2>
        </header>
        <div class="dlg-body">
          <label class="field">
            <span>{{ 'hq.bestand.bpPick.label' | translate }}</span>
            <input #q type="search" name="bp-q" autocomplete="off" maxlength="80" [value]="term()"
                   [placeholder]="'hq.bestand.bpPick.placeholder' | translate" (input)="onInput($any($event.target).value)"
                   aria-describedby="bp-pick-msg" />
          </label>
          <p id="bp-pick-msg" class="msg" role="status">
            @if (error(); as k) {
              <span class="err">{{ k | translate }}</span>
            } @else if (searching()) {
              {{ 'hq.bestand.bpPick.searching' | translate }}
            } @else if (answered() && !hits().length) {
              {{ 'hq.bestand.bpPick.none' | translate }}
            }
          </p>
          @if (hits().length) {
            <ul class="list" [attr.aria-label]="'hq.bestand.bpPick.results' | translate">
              @for (h of hits(); track h.className) {
                <li>
                  <span class="nm">{{ h.name }}</span>
                  @if (isOwned(h.className)) {
                    <span class="have">{{ 'hq.bestand.bpPick.owned' | translate }}</span>
                  } @else {
                    <button type="button" scAction tier="secondary" [attr.aria-label]="'hq.bestand.bpPick.addAria' | translate: { name: h.name }"
                            (click)="picked.emit(h)">{{ 'hq.bestand.bpPick.add' | translate }}</button>
                  }
                </li>
              }
            </ul>
          }
        </div>
        <footer class="dlg-foot"><span class="sp"></span><button type="button" scAction tier="secondary" (click)="closed.emit()">{{ 'common.dialog.close' | translate }}</button></footer>
      </div>
    </div>
  `,
  styles: [
    HQ_DIALOG_STYLES,
    `.field { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); }
     .field span { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor, 0.75rem)); }
     .field input { min-height: 44px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; }
     .field input:hover { border-color: var(--sc-accent); }
     .field input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
     .msg { margin: 0; min-height: 1.2em; color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor, 0.75rem)); }
     .err { color: var(--sc-warning); }
     .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
     .list li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
     .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
     .have { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor, 0.75rem)); }`,
  ],
})
export class HqBlueprintPickerComponent {
  private readonly codex = inject(CodexService);
  private readonly translate = inject(TranslateService);

  /** Class names (lower-cased) of the blueprints the reader already has. */
  readonly owned = input<ReadonlySet<string>>(new Set());
  readonly picked = output<PickedBlueprint>();
  readonly closed = output<void>();

  protected readonly term = signal('');
  readonly hits = signal<readonly PickedBlueprint[]>([]);
  protected readonly searching = signal(false);
  protected readonly answered = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('q');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  constructor() {
    afterNextRender(() => this.input()?.nativeElement.focus());
  }

  protected isOwned(className: string): boolean {
    return this.owned().has(className.toLowerCase());
  }

  onInput(v: string): void {
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
      const res = await this.codex.searchAll(t, 12);
      if (seq !== this.seq) return;
      const lang = toLang(this.translate.getCurrentLang() ?? this.translate.getFallbackLang());
      const seen = new Set<string>();
      const out: PickedBlueprint[] = [];
      for (const h of res.hits) {
        if (h.kind !== 'blueprint' || !h.classNameSlug || seen.has(h.classNameSlug.toLowerCase())) continue;
        seen.add(h.classNameSlug.toLowerCase());
        out.push({ className: h.classNameSlug, name: hitTitle(h, lang) });
      }
      this.hits.set(out);
      this.answered.set(true);
    } catch (err) {
      if (seq !== this.seq) return;
      this.hits.set([]);
      this.error.set(toErrorKey('hq', 'stock.search', err));
    } finally {
      if (seq === this.seq) this.searching.set(false);
    }
  }
}
