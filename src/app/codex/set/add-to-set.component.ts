import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { hqLocker, hqSet } from '../../hq/hq-routes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { CodexService } from '../codex.service';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { FpsSetPiece, fittingSlots } from './fps-set-fit';

/** What the popover shows — one step of the "add to set" flow at a time. */
export type AddToSetView = 'signedOut' | 'loading' | 'error' | 'noSet' | 'noFit' | 'pickSet' | 'pickSlot' | 'done';

/**
 * "Zum Set hinzufügen" for the plain FPS archive and an FPS item's detail
 * page (audit L09). Before it, the only way to put a piece into a set was to
 * start on the set page and come back here in equip mode.
 *
 * Flow: pick the set (skipped with one fitting set) → pick the slot (skipped
 * when the piece fits exactly one — armour always does) → the same merge
 * write equip mode uses (`setRoleLoadoutSlot`) → a confirmation with an
 * anchor to the set. Signed out or without a set, the popover says so and
 * links to the Hangar, where sets are created.
 *
 * Auth and the hangar store are read only once the popover opens: a grid of
 * sixty cards must not touch either just by rendering.
 */
@Component({
  selector: 'sc-add-to-set',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sc-add-to-set',
    '[class.open]': 'open()',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <button type="button" class="ats-trigger" #trigger
            aria-haspopup="dialog"
            [attr.aria-expanded]="open()"
            (click)="toggle()">
      <span aria-hidden="true">+</span> {{ 'fps.addToSet.trigger' | translate }}
    </button>
    @if (open()) {
      <div class="ats-pop sc-card" role="dialog"
           [attr.aria-label]="'fps.addToSet.dialogAria' | translate: { item: itemName() }"
           scDialog [scDialogModal]="false" [scDialogReturnFocus]="trigger"
           (scDialogEscape)="close()">
        @switch (view()) {
          @case ('signedOut') {
            <p class="ats-text">{{ 'fps.addToSet.signedOut' | translate }}</p>
            <a class="ats-link" [routerLink]="lockerLink">{{ 'fps.addToSet.createSet' | translate }} <span aria-hidden="true">→</span></a>
          }
          @case ('loading') {
            <p class="ats-text" role="status">{{ 'fps.addToSet.loading' | translate }}</p>
          }
          @case ('error') {
            <p class="ats-text ats-err" role="alert">{{ loadError()! | translate }}</p>
            <button type="button" class="ats-opt" (click)="retry()">{{ 'errors.retry' | translate }}</button>
          }
          @case ('noSet') {
            <p class="ats-text">{{ 'fps.addToSet.noSet' | translate }}</p>
            <a class="ats-link" [routerLink]="lockerLink">{{ 'fps.addToSet.createSet' | translate }} <span aria-hidden="true">→</span></a>
          }
          @case ('noFit') {
            <p class="ats-text">{{ 'fps.addToSet.noFit' | translate }}</p>
            <a class="ats-link" [routerLink]="lockerLink">{{ 'fps.addToSet.createSet' | translate }} <span aria-hidden="true">→</span></a>
          }
          @case ('pickSet') {
            <p class="ats-head">{{ 'fps.addToSet.pickSet' | translate }}</p>
            <ul class="ats-list">
              @for (s of fittingSets(); track s.id) {
                <li>
                  <button type="button" class="ats-opt" [attr.data-set]="s.id" (click)="chooseSet(s)">
                    <span class="ats-opt-name">{{ s.name }}</span>
                    <span class="ats-opt-sub">{{ ('hangar.roles.' + s.role) | translate }}</span>
                  </button>
                </li>
              }
            </ul>
          }
          @case ('pickSlot') {
            <p class="ats-head">{{ 'fps.addToSet.pickSlot' | translate: { set: chosenSet()?.name ?? '' } }}</p>
            <ul class="ats-list">
              @for (slot of chosenSlots(); track slot) {
                <li>
                  <button type="button" class="ats-opt" [attr.data-slot]="slot"
                          [disabled]="busy() || svc.viewingPastPatch()"
                          [attr.aria-busy]="busy() === slot"
                          (click)="equip(slot)">
                    <span class="ats-opt-name">{{ slotLabel(slot) }}</span>
                    @if (occupied(slot)) {
                      <span class="ats-opt-sub">{{ 'fps.addToSet.replaces' | translate }}</span>
                    }
                  </button>
                </li>
              }
            </ul>
          }
          @case ('done') {
            @if (confirmed(); as c) {
              <p class="ats-text ats-ok" role="status">
                <span aria-hidden="true">✓</span>
                {{ 'fps.addToSet.done' | translate: { item: itemName(), slot: slotLabel(c.slot), set: c.set.name } }}
              </p>
              <a class="ats-link" [routerLink]="setRoute(c.set.id)">{{ 'fps.addToSet.toSet' | translate }} <span aria-hidden="true">→</span></a>
            }
          }
        }
        @if (svc.viewingPastPatch() && (view() === 'pickSlot' || view() === 'pickSet')) {
          <p class="ats-text ats-note">{{ 'fps.equip.pastPatch' | translate }}</p>
        }
        @if (writeFailed()) {
          <p class="ats-text ats-err" role="alert">{{ 'fps.equip.failed' | translate }}</p>
        } @else if (conflict()) {
          <p class="ats-text ats-note" role="status">{{ 'fps.equip.changedElsewhere' | translate }}</p>
        }
        <button type="button" class="ats-close" (click)="close()">{{ 'fps.addToSet.close' | translate }}</button>
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; flex-direction: column; }
    .ats-trigger {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px; cursor: pointer;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); font-family: var(--sc-font-display);
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase;
      min-height: max(32px, var(--sc-tap-min));
    }
    .ats-trigger:hover, .ats-trigger[aria-expanded='true'] { border-color: var(--sc-accent); color: var(--sc-accent); }
    .ats-trigger:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .ats-pop {
      position: absolute; top: calc(100% + 6px); left: 0; z-index: 20;
      display: flex; flex-direction: column; gap: 8px;
      width: min(300px, calc(100vw - 32px)); box-sizing: border-box;
      padding: 12px; margin: 0;
      background: var(--sc-bg-1);
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      box-shadow: 0 8px 28px color-mix(in srgb, black 50%, transparent);
    }
    .ats-pop:focus { outline: none; }
    .ats-head { margin: 0; font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.08em;
      font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .ats-text { margin: 0; color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); }
    .ats-ok { color: var(--sc-fg-0); }
    .ats-ok span { color: var(--sc-accent); font-weight: 700; }
    .ats-err { color: var(--sc-danger); }
    .ats-note { color: color-mix(in srgb, var(--sc-warning) 80%, var(--sc-fg-1)); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .ats-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .ats-opt {
      display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;
      padding: 8px 10px; border-radius: 6px; cursor: pointer; text-align: left;
      border: 1px solid var(--sc-border); background: var(--sc-bg-0);
      color: var(--sc-fg-0); font-family: inherit; font-size: max(0.84rem, var(--sc-fs-floor));
      min-height: var(--sc-tap-min);
    }
    .ats-opt:hover:not(:disabled), .ats-opt:focus-visible { border-color: var(--sc-accent); }
    .ats-opt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .ats-opt:disabled { opacity: 0.5; cursor: default; }
    .ats-opt-sub { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .ats-link {
      display: inline-flex; align-items: center; gap: 4px; min-height: var(--sc-tap-min);
      color: var(--sc-accent); text-decoration: none;
      font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.06em;
      font-size: max(0.72rem, var(--sc-fs-floor));
    }
    .ats-link:hover, .ats-link:focus-visible { text-decoration: underline; }
    .ats-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .ats-close {
      align-self: flex-end; padding: 4px 10px; border-radius: 6px; cursor: pointer;
      border: 1px solid transparent; background: transparent; color: var(--sc-fg-2);
      font-family: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); min-height: var(--sc-tap-min);
    }
    .ats-close:hover, .ats-close:focus-visible { color: var(--sc-accent); border-color: var(--sc-border); }
    @media (pointer: coarse) {
      .ats-trigger { min-height: max(44px, var(--sc-tap-min)); }
    }
  `],
})
export class AddToSetComponent {
  readonly lockerLink = hqLocker;

  setRoute(id: string): string[] {
    return hqSet(id);
  }

  readonly svc = inject(CodexService);
  private readonly t = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Class name of the piece, as the set stores it. */
  readonly className = input.required<string>();
  /** Codex kind the set records next to it ('weapon' / 'item'). */
  readonly kind = input.required<'weapon' | 'item'>();
  readonly subType = input<string | null>(null);
  readonly attachType = input<string | null>(null);
  /** Display name — the confirmation and the dialog's label say it. */
  readonly itemName = input.required<string>();

  readonly open = signal(false);
  readonly signedIn = signal(false);
  readonly loading = signal(false);
  /** i18n key of a failed set read; never raw text. */
  readonly loadError = signal<string | null>(null);
  readonly sets = signal<HangarRoleLoadout[]>([]);
  readonly chosenSet = signal<HangarRoleLoadout | null>(null);
  /** Slot of the write in flight. */
  readonly busy = signal<string | null>(null);
  readonly writeFailed = signal(false);
  readonly conflict = signal(false);
  readonly confirmed = signal<{ set: HangarRoleLoadout; slot: string } | null>(null);

  private readonly piece = computed<FpsSetPiece>(() => ({
    className: this.className(),
    subType: this.subType(),
    attachType: this.attachType(),
  }));

  /** The sets with at least one slot this piece fits, newest first (the store's order). */
  readonly fittingSets = computed(() => this.sets().filter((s) => fittingSlots(s, this.piece()).length > 0));
  readonly chosenSlots = computed(() => {
    const set = this.chosenSet();
    return set ? fittingSlots(set, this.piece()) : [];
  });

  readonly view = computed<AddToSetView>(() => {
    if (!this.signedIn()) return 'signedOut';
    if (this.confirmed()) return 'done';
    if (this.loading()) return 'loading';
    if (this.loadError()) return 'error';
    if (this.sets().length === 0) return 'noSet';
    if (this.fittingSets().length === 0) return 'noFit';
    return this.chosenSet() ? 'pickSlot' : 'pickSet';
  });

  toggle(): void {
    if (this.open()) this.close();
    else void this.openPopover();
  }

  close(): void {
    this.open.set(false);
  }

  /** A click outside the control closes it, the way any menu does. */
  onDocumentClick(ev: Event): void {
    if (this.open() && ev.target instanceof Node && !this.host.contains(ev.target)) this.close();
  }

  private async openPopover(): Promise<void> {
    this.chosenSet.set(null);
    this.confirmed.set(null);
    this.writeFailed.set(false);
    this.conflict.set(false);
    this.open.set(true);
    const auth = this.injector.get(AuthService);
    this.signedIn.set(!!auth.user());
    if (!this.signedIn()) return;
    await this.loadSets();
  }

  retry(): void {
    void this.loadSets();
  }

  private async loadSets(): Promise<void> {
    const hangar = this.injector.get(HangarService);
    this.loadError.set(null);
    if (hangar.roleLoadouts().length === 0) {
      this.loading.set(true);
      try {
        await hangar.loadAll();
      } finally {
        this.loading.set(false);
      }
      const err = hangar.error();
      if (err) {
        this.loadError.set(err);
        return;
      }
    }
    this.sets.set(hangar.roleLoadouts());
    const fitting = this.fittingSets();
    // One set the piece fits: no question to ask.
    if (fitting.length === 1) await this.chooseSet(fitting[0]);
  }

  async chooseSet(set: HangarRoleLoadout): Promise<void> {
    this.chosenSet.set(set);
    const slots = fittingSlots(set, this.piece());
    // Exactly one slot fits (armour always): write straight away.
    if (slots.length === 1) await this.equip(slots[0]);
  }

  occupied(slot: string): boolean {
    return !!this.chosenSet()?.items.some((i) => i.slot === slot && i.className && i.className !== this.className());
  }

  slotLabel(slot: string): string {
    const key = 'hangar.slots.' + slot;
    const label = this.t.instant(key);
    return label === key ? slot : label;
  }

  /**
   * The equip-mode write: merged against the server's copy of the set. The
   * piece the popover showed in the slot rides along as `expect`, so a newer
   * one another tab put there is not overwritten blind — the popover then
   * says so and shows the fresh set.
   */
  async equip(slot: string): Promise<void> {
    const set = this.chosenSet();
    if (!set || this.busy() || this.svc.viewingPastPatch()) return;
    const shown = set.items.find((i) => i.slot === slot)?.className ?? undefined;
    this.busy.set(slot);
    this.writeFailed.set(false);
    this.conflict.set(false);
    try {
      const updated = await this.injector
        .get(HangarService)
        .setRoleLoadoutSlot(set.id, slot, { className: this.className(), kind: this.kind() }, shown)
        .catch(() => null);
      if (!updated) {
        this.writeFailed.set(true);
        return;
      }
      this.sets.update((all) => all.map((s) => (s.id === updated.id ? updated : s)));
      if (updated.items.some((i) => i.slot === slot && i.className === this.className())) {
        this.confirmed.set({ set: updated, slot });
      } else {
        this.chosenSet.set(updated);
        this.conflict.set(true);
      }
    } finally {
      this.busy.set(null);
    }
  }
}
