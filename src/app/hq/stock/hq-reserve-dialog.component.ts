import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { FriendsService } from '../../social/friends.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HQ_DIALOG_STYLES } from '../plan/hq-dialog.styles';
import { type IndexedReservation, defaultAmount, expiryToField, freeForQuality, indexedReservations, reserveTarget } from './hq-reserve';
import { parseAmount } from './hq-stock-counter';
import type { DeckCrate } from './hq-stock-deck';

/**
 * "Reservieren" (D2 / I8, screens a3-s6/a3-s7): the friend (from the friend list) OR a free text, the amount (default =
 * the free amount, "10 von 15 SCU"), an optional quality stack and an optional expiry. With ONE container selected the
 * dialog also lists its reservations to edit, release or hand out; with several it reserves each container's free amount.
 * Closes only through its X, Abbrechen or Escape; resolves `true` when something was written.
 */
@Component({
  selector: 'sc-hq-reserve-dialog',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ScActionDirective, ScDialogDirective, ScSelectComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit(changed())" aria-labelledby="rsv-title">
        <header class="dlg-head">
          <span class="dlg-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="lock" /></svg></span>
          <h2 id="rsv-title" class="dlg-title">{{ (editing() ? 'hq.bestand.deck.rsv.titleEdit' : 'hq.bestand.deck.rsv.title') | translate }}
            <small>{{ subtitle() }}</small></h2>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.flow.close' | translate" [scTooltip]="'hq.flow.close' | translate" scTooltipTier="label" (click)="closed.emit(changed())">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div class="dlg-body">
          @if (error(); as e) { <p class="dlg-err" role="alert">{{ e | translate }}</p> }

          @if (existing().length) {
            <section class="have" aria-labelledby="rsv-have">
              <small id="rsv-have">{{ 'hq.bestand.deck.rsv.existing' | translate }}</small>
              <ul>
                @for (r of existing(); track r.id ?? r.index) {
                  <li [class.on]="editId() === r.id">
                    <span class="who"><b>{{ whoOf(r) }}</b>
                      <em>{{ fmt(r.amount) }}@if (r.quality) { · Q {{ r.quality }} }@if (r.expiresAt) { · {{ 'hq.bestand.deck.rsv.until' | translate: { date: dateOf(r.expiresAt) } }} }</em></span>
                    <span class="acts">
                      <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.bestand.deck.rsv.edit' | translate" [scTooltip]="'hq.bestand.deck.rsv.edit' | translate" scTooltipTier="label" (click)="startEdit(r)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
                      </button>
                      <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.bestand.deck.rsv.release' | translate" [scTooltip]="'hq.bestand.deck.rsv.release' | translate" scTooltipTier="label" (click)="end(r, false)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 9.5-2M5 11h14v9H5z" /></svg>
                      </button>
                      <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.bestand.deck.rsv.handout' | translate" [scTooltip]="'hq.bestand.deck.rsv.handout' | translate" scTooltipTier="label" (click)="end(r, true)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                      </button>
                    </span>
                  </li>
                }
              </ul>
            </section>
          }

          <section class="form" aria-labelledby="rsv-for">
            <small id="rsv-for">{{ 'hq.bestand.deck.rsv.for' | translate }}</small>
            <div class="row">
              <label class="fld">
                <span>{{ 'hq.bestand.deck.rsv.friend' | translate }}</span>
                <sc-select [options]="friendOptions()" [value]="friendId()" [allowEmpty]="true" placeholderKey="hq.bestand.deck.rsv.noFriend"
                           [ariaLabel]="'hq.bestand.deck.rsv.friend' | translate" (valueChange)="friendId.set($event)" />
              </label>
              <label class="fld">
                <span>{{ 'hq.bestand.deck.rsv.note' | translate }}</span>
                <input type="text" class="input" maxlength="120" autocomplete="off" [ngModel]="note()" (ngModelChange)="note.set($event)"
                       [placeholder]="'hq.bestand.deck.rsv.notePlaceholder' | translate" />
              </label>
            </div>
            <div class="row">
              @if (single()) {
                <label class="fld">
                  <span>{{ 'hq.bestand.deck.rsv.amount' | translate }}</span>
                  <span class="amt">
                    <input type="text" class="input num" inputmode="decimal" autocomplete="off" [ngModel]="amountText()" (ngModelChange)="amountText.set($event)"
                           [attr.aria-invalid]="amountBad() ? 'true' : null" />
                    <i>{{ 'hq.bestand.deck.rsv.of' | translate: { free: fmt(free()) } }}</i>
                  </span>
                </label>
                @if (qualityOptions().length) {
                  <label class="fld">
                    <span>{{ 'hq.bestand.deck.rsv.quality' | translate }}</span>
                    <sc-select [options]="qualityOptions()" [value]="quality() === null ? null : '' + quality()" [allowEmpty]="true" placeholderKey="hq.bestand.deck.rsv.anyQuality"
                               [ariaLabel]="'hq.bestand.deck.rsv.quality' | translate" (valueChange)="onQuality($event)" />
                  </label>
                }
              } @else {
                <p class="hint">{{ 'hq.bestand.deck.rsv.multi' | translate: { n: crates().length } }}</p>
              }
              <label class="fld">
                <span>{{ 'hq.bestand.deck.rsv.expiry' | translate }}</span>
                <input type="date" class="input" [ngModel]="expiryDay()" (ngModelChange)="expiryDay.set($event)" [min]="today" />
              </label>
            </div>
            @if (friendId()) { <p class="hint">{{ 'hq.bestand.deck.rsv.notify' | translate }}</p> }
            @if (needsWho()) { <p class="dlg-err" role="alert">{{ 'hq.bestand.deck.reserveNeedsNote' | translate }}</p> }
            @if (amountBad()) { <p class="dlg-err" role="alert">{{ 'hq.bestand.deck.rsv.amountBad' | translate: { free: fmt(free()) } }}</p> }
          </section>
        </div>

        <footer class="dlg-foot">
          <span class="sp"></span>
          @if (editing()) { <button type="button" scAction tier="secondary" (click)="cancelEdit()">{{ 'hq.bestand.deck.rsv.newOne' | translate }}</button> }
          <button type="button" scAction tier="secondary" (click)="closed.emit(changed())">{{ 'common.dialog.cancel' | translate }}</button>
          <button type="button" scAction tier="primary" [busy]="busy()" [disabled]="busy() || !canSave()" (click)="save()">
            {{ (editing() ? 'hq.bestand.deck.rsv.saveEdit' : 'hq.bestand.deck.reserve') | translate }}
          </button>
        </footer>
      </div>
    </div>
  `,
  styles: [
    HQ_DIALOG_STYLES,
    `
      .have, .form { padding: var(--sc-space-3, 12px); border: 1px dashed var(--sc-border); border-radius: 10px; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .have > small, .form > small { color: var(--sc-fg-2); }
      .have ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .have li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
      .have li.on { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .who { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
      .who em { font-style: normal; color: var(--sc-fg-2); font-size: 0.8rem; }
      .acts { display: inline-flex; flex: none; }
      .acts svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .row { display: flex; flex-wrap: wrap; gap: var(--sc-space-3, 12px); }
      .fld { flex: 1 1 11rem; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .fld > span:first-child { color: var(--sc-fg-2); font-size: 0.82rem; }
      .amt { display: flex; align-items: center; gap: var(--sc-space-2, 8px); }
      .amt i { font-style: normal; color: var(--sc-fg-2); font-size: 0.8rem; white-space: nowrap; }
      .num { width: 7rem; }
      .input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg-0); font: inherit; color-scheme: dark; }
      .input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .input[aria-invalid='true'] { border-color: var(--sc-warning); }
      .hint { margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; }
      @media (pointer: coarse) { .input { min-height: 48px; } }
    `,
  ],
})
export class HqReserveDialogComponent {
  readonly crates = input.required<readonly DeckCrate[]>();
  readonly closed = output<boolean>();

  private readonly inv = inject(HqInventoryService);
  private readonly friends = inject(FriendsService);
  private readonly confirm = inject(ScConfirmService);
  private readonly i18n = inject(TranslateService);

  protected readonly lock = 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z';
  protected readonly today = expiryToField(new Date().toISOString());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly changed = signal(false);
  protected readonly friendId = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly quality = signal<number | null>(null);
  protected readonly expiryDay = signal('');
  protected readonly amountText = signal('');
  protected readonly editId = signal<string | null>(null);
  protected readonly editing = computed(() => this.editId() !== null);

  protected readonly single = computed(() => this.crates().length === 1);
  /** The one container (single mode) as the dialog sees it live. */
  protected readonly crate = computed<DeckCrate | null>(() => (this.single() ? this.crates()[0] : null));
  protected readonly row = computed(() => {
    const c = this.crate();
    return c ? this.inv.items().find((i) => i.location === c.location && i.name === c.name) : undefined;
  });
  protected readonly existing = computed<IndexedReservation[]>(() => indexedReservations(this.row()));
  protected readonly subtitle = computed(() => {
    const c = this.crate();
    return c ? c.name : this.i18n.instant('hq.bestand.deck.selected', { n: this.crates().length });
  });

  protected readonly friendOptions = computed<ScSelectOption[]>(() =>
    this.friends.graph().friends.map((f) => ({ value: f.user_id, labelKey: 'common.select.none', label: f.display_name || f.username || f.user_id })),
  );
  protected readonly qualityOptions = computed<ScSelectOption[]>(() => {
    const c = this.crate();
    if (!c) return [];
    return c.stacks
      .filter((s) => s.quality !== null)
      .map((s) => ({ value: String(s.quality), labelKey: 'common.select.none', label: `Q ${s.quality} · ${this.fmt(s.available)}` }));
  });

  /** What a (new) reservation can take now; while editing, the edited one's own amount counts back in. */
  protected readonly free = computed(() => {
    const c = this.crate();
    if (!c) return 0;
    const own = this.existing().find((r) => r.id === this.editId());
    const back = own && (own.quality ?? null) === this.quality() ? own.amount : 0;
    return freeForQuality(c, this.quality()) + back;
  });
  private readonly amount = computed<number | null>(() => {
    if (!this.single()) return null;
    return parseAmount(this.amountText(), this.crate()!.unit);
  });
  protected readonly amountBad = computed(() => this.single() && this.amountText().trim() !== '' && (this.amount() === null || this.amount()! > this.free() + 1e-9));
  protected readonly needsWho = computed(() => !this.friendId() && !this.note().trim() && (this.note() !== '' || this.amountText() !== ''));
  protected readonly canSave = computed(() => {
    if (!this.friendId() && !this.note().trim()) return false;
    if (this.single()) return this.amount() !== null && this.amount()! <= this.free() + 1e-9;
    return this.crates().some((c) => c.available > 0);
  });

  constructor() {
    void this.friends.load();
    queueMicrotask(() => this.resetAmount());
  }

  protected fmt(n: number): string {
    const v = n.toLocaleString(this.i18n.getCurrentLang() || undefined, { maximumFractionDigits: 3 });
    return this.crate()?.unit === 'pcs' ? `×${v}` : `${v} SCU`;
  }

  protected dateOf(iso: string): string {
    return new Date(iso).toLocaleDateString(this.i18n.getCurrentLang() || undefined);
  }

  protected whoOf(r: IndexedReservation): string {
    const f = r.friendId ? this.friends.graph().friends.find((x) => x.user_id === r.friendId) : null;
    const name = f ? f.display_name || f.username : null;
    return [name, r.note].filter((x) => !!x).join(' · ') || '—';
  }

  protected onQuality(v: string | null): void {
    this.quality.set(v === null ? null : Number(v));
    if (!this.editing()) this.resetAmount();
  }

  private resetAmount(): void {
    const c = this.crate();
    this.amountText.set(c ? String(defaultAmount(c, this.quality())) : '');
  }

  protected startEdit(r: IndexedReservation): void {
    if (!r.id) return;
    this.editId.set(r.id);
    this.friendId.set(r.friendId ?? null);
    this.note.set(r.note);
    this.quality.set(r.quality ?? null);
    this.expiryDay.set(expiryToField(r.expiresAt));
    this.amountText.set(String(r.amount));
    this.error.set(null);
  }

  protected cancelEdit(): void {
    this.editId.set(null);
    this.friendId.set(null);
    this.note.set('');
    this.quality.set(null);
    this.expiryDay.set('');
    this.resetAmount();
  }

  protected async end(r: IndexedReservation, handedOut: boolean): Promise<void> {
    const c = this.crate();
    if (!c || this.busy()) return;
    if (handedOut) {
      const ok = await this.confirm.confirm({ titleKey: 'hq.bestand.deck.rsv.handoutTitle', messageKey: 'hq.bestand.deck.rsv.handoutMessage', params: { n: this.fmt(r.amount) }, confirmKey: 'hq.bestand.deck.rsv.handout', tone: 'danger' });
      if (!ok) return;
    }
    this.busy.set(true);
    try {
      const done = await this.inv.endReservation({ location: c.location, name: c.name }, r.index, handedOut);
      this.error.set(done ? null : (this.inv.error() ?? 'errors.generic'));
      if (done) {
        this.changed.set(true);
        if (this.editId() === r.id) this.cancelEdit();
      }
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.reserve', err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) return;
    const target = reserveTarget({ friendId: this.friendId(), note: this.note(), quality: this.single() ? this.quality() : null, expiryDay: this.expiryDay() });
    if (!target) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      let failed = false;
      if (this.single()) {
        const c = this.crates()[0];
        const ref = { location: c.location, name: c.name };
        const amount = this.amount()!;
        failed = !(this.editId()
          ? await this.inv.updateReservation(ref, this.editId()!, { amount, ...target })
          : await this.inv.reserve(ref, amount, target));
      } else {
        for (const c of this.crates()) {
          if (c.available <= 0) continue;
          if (!(await this.inv.reserve({ location: c.location, name: c.name }, c.available, target))) failed = true;
        }
      }
      if (failed) {
        this.error.set(this.inv.error() ?? 'errors.generic');
        return;
      }
      this.changed.set(true);
      if (this.single()) this.cancelEdit();
      else this.closed.emit(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'inventory.reserve', err));
    } finally {
      this.busy.set(false);
    }
  }
}
