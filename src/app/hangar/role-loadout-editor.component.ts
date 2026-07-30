import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { humanizeClassName } from '../codex/codex-format';
import { HangarItemPickerComponent, PickedItem } from './hangar-item-picker.component';
import { HangarService } from './hangar.service';
import {
  HangarRoleLoadout,
  ROLE_SLOT_SUGGESTIONS,
  RoleLoadoutItem,
} from './hangar.types';

/**
 * Role-loadout editor: ship-independent personal equipment sets
 * (FPS / mining / salvage / medical / engineering). Slots are free labels —
 * the role suggests a starter set, users add their own.
 */
@Component({
  selector: 'sc-role-loadout-editor',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, HangarItemPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <a class="back" routerLink="/hangar">← {{ 'hangar.detail.back' | translate }}</a>

      @if (notFound()) {
        <div class="sc-card empty"><strong>{{ 'hangar.detail.notFound' | translate }}</strong></div>
      } @else if (loadout(); as l) {
        <header class="head">
          <div class="title-block">
            <div class="name-row">
              @if (editingName()) {
                <input class="name-input" type="text" [ngModel]="nameDraft()" (ngModelChange)="nameDraft.set($event)"
                       (keyup.enter)="saveName()" (keyup.escape)="editingName.set(false)"
                       [attr.aria-label]="'hangar.detail.rename' | translate" />
                <button class="sc-btn small" type="button" (click)="saveName()">{{ 'hangar.detail.save' | translate }}</button>
              } @else {
                <h1>{{ l.name }}</h1>
                <button class="icon-btn" type="button" (click)="startEditName()"
                        [attr.aria-label]="'hangar.detail.rename' | translate">✎</button>
              }
            </div>
            <div class="badges">
              <span class="badge role">{{ ('hangar.roles.' + l.role) | translate }}</span>
              <span class="badge subtle">{{ 'hangar.roleLoadouts.itemCount' | translate: { count: filledCount() } }}</span>
            </div>
          </div>
          <button class="sc-btn small danger" type="button" (click)="remove()">
            {{ 'hangar.detail.remove' | translate }}
          </button>
        </header>

        <div class="sc-card slots">
          <h2>{{ 'hangar.roleLoadouts.slotsTitle' | translate }}</h2>
          <div class="slot-list">
            @for (slot of slots(); track slot) {
              <div class="slot">
                <span class="slot-label">{{ slot }}</span>
                <div class="slot-assign">
                  @if (itemFor(slot); as item) {
                    <span class="assign-name">{{ item.className ? itemName(item.className) : '' }}</span>
                  } @else {
                    <span class="assign-name empty">{{ 'hangar.loadout.empty' | translate }}</span>
                  }
                  <button class="sc-btn tiny" type="button" (click)="openPicker(slot)">
                    {{ 'hangar.loadout.change' | translate }}
                  </button>
                  @if (itemFor(slot)) {
                    <button class="sc-btn tiny ghost" type="button" (click)="clearSlot(slot)">
                      {{ 'hangar.loadout.clear' | translate }}
                    </button>
                  }
                </div>
                @if (pickerSlot() === slot) {
                  <sc-hangar-item-picker
                    [fpsOnly]="l.role === 'fps'"
                    (picked)="onPicked(slot, $event)"
                    (closed)="pickerSlot.set(null)" />
                }
              </div>
            }
          </div>

          <div class="add-slot">
            <input class="slot-input" type="text" [ngModel]="newSlot()" (ngModelChange)="newSlot.set($event)"
                   (keyup.enter)="addSlot()"
                   [attr.placeholder]="'hangar.roleLoadouts.addSlotPlaceholder' | translate"
                   [attr.aria-label]="'hangar.roleLoadouts.addSlotPlaceholder' | translate" />
            <button class="sc-btn small" type="button" [disabled]="!newSlot().trim()" (click)="addSlot()">
              {{ 'hangar.roleLoadouts.addSlot' | translate }}
            </button>
          </div>

          @if (dirty()) {
            <div class="save-row">
              <button class="sc-btn primary" type="button" (click)="save()">{{ 'hangar.configs.saveLoadout' | translate }}</button>
              <button class="sc-btn ghost" type="button" (click)="discard()">{{ 'hangar.configs.discard' | translate }}</button>
            </div>
          }
        </div>
      } @else {
        <div class="sc-card empty">{{ 'hangar.detail.loading' | translate }}</div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 16px; }
    .back { color: var(--sc-fg-2); text-decoration: none; font-size: 0.82rem; }
    .back:hover { color: var(--sc-accent); }
    .head { display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
    .name-row { display: flex; align-items: center; gap: 10px; }
    .name-row h1 { margin: 0; }
    .name-input { padding: 8px 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-accent); color: var(--sc-fg-0); font-size: 1.1rem; font-family: inherit; }
    .icon-btn { border: none; background: transparent; color: var(--sc-fg-2); cursor: pointer; font-size: 1rem; }
    .icon-btn:hover { color: var(--sc-accent); }
    .badges { display: flex; gap: 6px; margin-top: 8px; }
    .badge { font-size: max(0.68rem, var(--sc-fs-floor)); padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .badge.role { text-transform: uppercase; letter-spacing: 0.05em; }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }

    .sc-card h2 { margin: 0 0 12px; font-size: 1rem; }
    .slot-list { display: flex; flex-direction: column; gap: 6px; }
    .slot { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .slot-label { font-size: max(0.72rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .slot-assign { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .assign-name { flex: 1; font-size: 0.86rem; min-width: 140px; }
    .assign-name.empty { color: var(--sc-fg-2); font-style: italic; }

    .add-slot { display: flex; gap: 8px; margin-top: 12px; }
    .slot-input { flex: 1; max-width: 280px; padding: 7px 10px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.84rem; }
    .slot-input:focus { outline: none; border-color: var(--sc-accent); }
    .save-row { display: flex; gap: 8px; margin-top: 14px; }

    .sc-btn { padding: 8px 14px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase; cursor: pointer; }
    .sc-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .sc-btn:disabled { opacity: 0.5; cursor: default; }
    .sc-btn.small { padding: 7px 12px; font-size: max(0.7rem, var(--sc-fs-floor)); }
    .sc-btn.tiny { padding: 4px 9px; font-size: max(0.64rem, var(--sc-fs-floor)); }
    .sc-btn.ghost { border-color: var(--sc-border); color: var(--sc-fg-1); }
    .sc-btn.ghost:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .sc-btn.danger { border-color: var(--sc-danger); color: var(--sc-danger); }
    .sc-btn.danger:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .sc-btn.primary { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .empty { text-align: center; padding: 28px; color: var(--sc-fg-2); }
  `],
})
export class RoleLoadoutEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hangar = inject(HangarService);

  readonly loadout = signal<HangarRoleLoadout | null>(null);
  readonly notFound = signal(false);
  readonly draft = signal<Map<string, RoleLoadoutItem>>(new Map());
  readonly extraSlots = signal<string[]>([]);
  readonly dirty = signal(false);
  readonly pickerSlot = signal<string | null>(null);
  readonly newSlot = signal('');
  readonly editingName = signal(false);
  readonly nameDraft = signal('');

  /** suggested role slots + slots present in the data + user-added ones. */
  readonly slots = computed(() => {
    const l = this.loadout();
    if (!l) return [];
    const suggested = ROLE_SLOT_SUGGESTIONS[l.role] ?? [];
    const fromData = [...this.draft().keys()];
    return Array.from(new Set([...suggested, ...fromData, ...this.extraSlots()]));
  });

  readonly filledCount = computed(
    () => [...this.draft().values()].filter((i) => i.className).length,
  );

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.notFound.set(true);
      return;
    }
    const loadout = await this.hangar.getRoleLoadout(id);
    if (!loadout) {
      this.notFound.set(true);
      return;
    }
    this.loadout.set(loadout);
    this.resetDraft(loadout);
  }

  itemFor(slot: string): RoleLoadoutItem | null {
    return this.draft().get(slot) ?? null;
  }

  itemName(className: string): string {
    return humanizeClassName(className);
  }

  openPicker(slot: string): void {
    this.pickerSlot.set(slot);
  }

  onPicked(slot: string, item: PickedItem): void {
    const next = new Map(this.draft());
    next.set(slot, { slot, className: item.className, kind: item.kind });
    this.draft.set(next);
    this.dirty.set(true);
    this.pickerSlot.set(null);
  }

  clearSlot(slot: string): void {
    const next = new Map(this.draft());
    next.delete(slot);
    this.draft.set(next);
    this.dirty.set(true);
  }

  addSlot(): void {
    const slot = this.newSlot().trim().toLowerCase();
    if (!slot || this.slots().includes(slot)) {
      this.newSlot.set('');
      return;
    }
    this.extraSlots.set([...this.extraSlots(), slot]);
    this.newSlot.set('');
  }

  async save(): Promise<void> {
    const l = this.loadout();
    if (!l) return;
    const items = [...this.draft().values()];
    const updated = await this.hangar.updateRoleLoadout(l.id, { items });
    if (updated) {
      this.loadout.set(updated);
      this.resetDraft(updated);
    }
  }

  discard(): void {
    const l = this.loadout();
    if (l) this.resetDraft(l);
  }

  startEditName(): void {
    this.nameDraft.set(this.loadout()?.name ?? '');
    this.editingName.set(true);
  }

  async saveName(): Promise<void> {
    const l = this.loadout();
    const name = this.nameDraft().trim();
    if (!l || !name) {
      this.editingName.set(false);
      return;
    }
    const updated = await this.hangar.updateRoleLoadout(l.id, { name });
    if (updated) this.loadout.set(updated);
    this.editingName.set(false);
  }

  async remove(): Promise<void> {
    const l = this.loadout();
    if (!l) return;
    if (await this.hangar.deleteRoleLoadout(l.id)) {
      void this.router.navigate(['/hangar']);
    }
  }

  private resetDraft(loadout: HangarRoleLoadout): void {
    this.draft.set(new Map(loadout.items.filter((i) => i.slot).map((i) => [i.slot, i])));
    this.dirty.set(false);
    this.pickerSlot.set(null);
  }
}
