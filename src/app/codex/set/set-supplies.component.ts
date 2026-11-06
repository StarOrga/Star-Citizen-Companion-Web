import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { RoleLoadoutItem } from '../../hangar/hangar.types';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { hqPage } from '../../hq/hq-routes';
import { HqSuppliesService, SupplyItem } from '../../hq/hq-supplies.service';
import { ResolvedEntity } from '../codex.service';
import { cleanLocaleValue, humanizeClassName } from '../codex-format';

/** One set part that is neither owned (inventory) nor already an open Nachschub line of this set. */
export interface MissingPart {
  className: string;
  name: string;
  kind: string | null;
}

/**
 * What of a set still has to be fetched: every equipped part whose class is not in the reader's
 * inventory and not already an open Nachschub line of this set. A part equipped twice counts once.
 */
export function missingParts(
  setId: string,
  items: readonly RoleLoadoutItem[],
  ownedClasses: ReadonlySet<string>,
  supplies: readonly SupplyItem[],
  resolved: ReadonlyMap<string, ResolvedEntity>,
): MissingPart[] {
  const open = new Set(
    supplies.filter((s) => !s.done && s.setId === setId && s.className).map((s) => s.className!.toLowerCase()),
  );
  const seen = new Set<string>();
  const out: MissingPart[] = [];
  for (const it of items) {
    const cn = it.className;
    if (!cn) continue;
    const key = cn.toLowerCase();
    if (seen.has(key) || ownedClasses.has(key) || open.has(key)) continue;
    seen.add(key);
    out.push({ className: cn, name: cleanLocaleValue(resolved.get(cn)?.nameLocalized) || humanizeClassName(cn), kind: it.kind });
  }
  return out;
}

/**
 * The set editor's one-click "Fehlendes in Nachschub": adds every part the reader does not own
 * yet as a Nachschub line of this set, so Planen can route it. Owned = in the HQ inventory.
 */
@Component({
  selector: 'sc-set-supplies',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (missing().length > 0) {
      <button type="button" scAction tier="secondary" class="add" (click)="add()">
        <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icon; track $index) { <path [attr.d]="d" /> }</svg>
        <span>{{ 'codex.set.supplies.add' | translate: { n: missing().length } }}</span>
      </button>
    } @else if (hasParts()) {
      <span class="note">{{ 'codex.set.supplies.none' | translate }}</span>
    }
    @if (added() > 0) {
      <span class="note" role="status">{{ 'codex.set.supplies.added' | translate: { n: added() } }}</span>
    }
    @if (added() > 0 || inSupplies() > 0) {
      <a class="plan" [routerLink]="planLink.commands" [fragment]="planLink.fragment">
        {{ 'codex.set.supplies.toPlan' | translate }} <span aria-hidden="true">›</span>
      </a>
    }
  `,
  styles: [
    `
      :host { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px) var(--sc-space-3, 12px); }
      :host:empty { display: none; }
      .add { min-height: var(--sc-tap-min, 44px); }
      .note { color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
      .plan { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); color: var(--sc-accent); text-decoration: none; }
      .plan:hover { text-decoration: underline; }
      .plan:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    `,
  ],
})
export class SetSuppliesComponent implements OnInit {
  protected readonly icon = PATH_ICONS.nachschub;
  private readonly supplies = inject(HqSuppliesService);
  private readonly inventory = inject(HqInventoryService);

  readonly setId = input.required<string>();
  readonly items = input.required<readonly RoleLoadoutItem[]>();
  readonly resolved = input<ReadonlyMap<string, ResolvedEntity>>(new Map());

  readonly planLink = hqPage('planen');
  readonly added = signal(0);

  private readonly owned = computed(
    () => new Set(this.inventory.items().filter((i) => i.qty > 0 && i.class_name).map((i) => i.class_name!.toLowerCase())),
  );
  readonly missing = computed(() =>
    missingParts(this.setId(), this.items(), this.owned(), this.supplies.items(), this.resolved()),
  );
  readonly hasParts = computed(() => this.items().some((i) => !!i.className));
  readonly inSupplies = computed(() => this.supplies.items().filter((s) => !s.done && s.setId === this.setId()).length);

  ngOnInit(): void {
    if (!this.inventory.loaded()) void this.inventory.load();
  }

  add(): void {
    let n = 0;
    for (const p of this.missing()) {
      const ok = this.supplies.add(p.name, 1, {
        className: p.className,
        entityKind: p.kind?.slice(0, 40) ?? null,
        setKind: 'fps',
        setId: this.setId(),
        source: 'set',
      });
      if (ok) n++;
    }
    this.added.set(n);
  }
}
