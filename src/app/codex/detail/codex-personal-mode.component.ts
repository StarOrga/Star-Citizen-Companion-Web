import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HQ_MINE_PARAM, HQ_VARIANT_PARAM, HqLink, hqSet, personalShipLink } from '../../hq/hq-routes';
import type { HqConfigRef, HqOwnership } from '../../hq/hq-ownership.service';

/** Query params that leave every personal source behind: the codex view. */
export const CODEX_MODE_PARAMS: Record<string, null> = {
  [HQ_VARIANT_PARAM]: null,
  [HQ_MINE_PARAM]: null,
  config: null,
  loadout: null,
};

/**
 * The header switch of a codex detail page: [Codex | Meine ▾]. Codex is the
 * game's knowledge, the same for everyone; "Meine" is the reader's own copy —
 * on a ship one of their variants (`?v=`), elsewhere the `?mine` flag. Both
 * segments are real anchors: switching only changes the query param, and a
 * middle click opens the other mode in a new tab. The ship menu lists every
 * variant of this hull as its own anchor.
 *
 * Rendered only when the reader owns something of the entity — the page
 * decides that, this component just draws the choice.
 */
@Component({
  selector: 'sc-codex-mode-switch',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
  template: `
    <div class="mode" role="group" [attr.aria-label]="'codex.personal.switchGroup' | translate">
      <a class="seg" [class.active]="!personal()" [attr.aria-current]="!personal() ? 'true' : null"
         [routerLink]="[]" [queryParams]="codexParams" queryParamsHandling="merge">{{ 'codex.personal.codex' | translate }}</a>
      @if (kind() === 'ship') {
        <span class="mine-wrap">
          <button type="button" class="seg mine" [class.active]="personal()"
                  aria-haspopup="true" [attr.aria-expanded]="open()" (click)="toggle()" (keydown.escape)="close()">
            @if (personal() && activeVariantName(); as name) {
              {{ 'codex.personal.yourVariant' | translate: { name: name } }}
            } @else {
              {{ 'codex.personal.mine' | translate }}
            }
            <span aria-hidden="true" class="caret">▾</span>
          </button>
          @if (open()) {
            <ul class="menu" [attr.aria-label]="'codex.personal.variantsMenu' | translate" (keydown.escape)="close()">
              @for (c of variants(); track c.id) {
                <li>
                  <a class="item" [class.current]="c.id === activeVariantId()"
                     [attr.aria-current]="c.id === activeVariantId() ? 'true' : null"
                     [routerLink]="variantLink(c.id).commands" [queryParams]="variantLink(c.id).queryParams"
                     queryParamsHandling="merge" (click)="close()">{{ c.name }}</a>
                </li>
              }
            </ul>
          }
        </span>
      } @else {
        <a class="seg" [class.active]="personal()" [attr.aria-current]="personal() ? 'true' : null"
           [routerLink]="[]" [queryParams]="mineParams" queryParamsHandling="merge">{{ 'codex.personal.mine' | translate }}</a>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }
    .mode { display: inline-flex; border: 1px solid var(--sc-border); border-radius: 6px; background: var(--sc-bg-1); }
    .seg { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 12px; border: 0;
      background: transparent; color: var(--sc-fg-1); font: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
      text-decoration: none; cursor: pointer; border-radius: 5px; }
    .seg:hover { color: var(--sc-fg-0); }
    .seg.active { background: color-mix(in srgb, var(--sc-accent) 20%, transparent); color: var(--sc-accent); font-weight: 600; }
    .seg:focus-visible, .item:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .mine-wrap { position: relative; display: inline-flex; }
    .caret { font-size: 0.7em; }
    .menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 20; min-width: 200px; margin: 0; padding: 4px;
      list-style: none; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 6px;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
    .item { display: flex; align-items: center; min-height: 40px; padding: 6px 10px; border-radius: 4px;
      color: var(--sc-fg-0); text-decoration: none; font-size: max(0.8rem, var(--sc-fs-floor)); }
    .item:hover { background: var(--sc-bg-2); }
    .item.current { color: var(--sc-accent); font-weight: 600; }
    @media (pointer: coarse) { .seg { min-height: 48px; } .item { min-height: 48px; } }
  `],
})
export class CodexModeSwitchComponent {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly kind = input.required<string>();
  readonly className = input.required<string>();
  /** The page shows the reader's own copy. */
  readonly personal = input(false);
  /** Ships: the reader's variants of this hull (active first). */
  readonly variants = input<readonly HqConfigRef[]>([]);
  readonly activeVariantId = input<string | null>(null);

  readonly open = signal(false);
  readonly codexParams = CODEX_MODE_PARAMS;
  readonly mineParams = { [HQ_MINE_PARAM]: '' };

  readonly activeVariantName = computed(() => {
    const id = this.activeVariantId();
    return this.variants().find((c) => c.id === id)?.name ?? null;
  });

  /** A variant link drops every other loadout source, so the variant itself shows. */
  variantLink(configId: string): HqLink {
    const l = personalShipLink(this.className(), configId);
    return { commands: l.commands, queryParams: { ...l.queryParams, config: null, loadout: null, shared: null } as Record<string, string> };
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  close(): void {
    this.open.set(false);
  }

  onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}

/**
 * The "where is it mine" part of a component / weapon / item page. Codex
 * mode: a compact signpost chip ("2× in deinem HQ →") into `?mine`. Personal
 * mode: every ship variant the piece is fitted on and every set it is part
 * of, each a real anchor into the reader's own copy.
 */
@Component({
  selector: 'sc-codex-personal-uses',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ownership(); as o) {
      @if (count() > 0) {
        @if (!personal()) {
          <a class="hq-chip" [routerLink]="[]" [queryParams]="mineParams" queryParamsHandling="merge">
            {{ 'codex.personal.inHqChip' | translate: { n: count() } }} <span aria-hidden="true">→</span>
          </a>
        } @else {
          <section class="uses sc-card" [attr.aria-label]="'codex.personal.usesTitle' | translate">
            <h2 class="title">{{ 'codex.personal.usesTitle' | translate }}</h2>
            <ul class="list">
              @for (e of o.equippedOn; track e.configId + e.portName) {
                <li>
                  <a [routerLink]="shipLink(e.shipClassName, e.configId).commands"
                     [queryParams]="shipLink(e.shipClassName, e.configId).queryParams">
                    {{ 'codex.personal.equippedOn' | translate: { ship: e.shipName || e.shipClassName, variant: e.configName } }}
                  </a>
                </li>
              }
              @for (s of o.inSets; track s.setId) {
                <li><a [routerLink]="setLink(s.setId)">{{ 'codex.personal.inSet' | translate: { name: s.setName } }}</a></li>
              }
            </ul>
          </section>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .hq-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 12px; border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 10%, transparent); text-decoration: none;
      font-size: max(0.78rem, var(--sc-fs-floor)); }
    .hq-chip:hover { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .uses { padding: 12px 14px; }
    .title { margin: 0 0 8px; font-family: var(--sc-font-display); font-size: max(0.78rem, var(--sc-fs-floor));
      letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .list a { display: inline-flex; align-items: center; min-height: 36px; color: var(--sc-accent); text-decoration: none; }
    .list a:hover { text-decoration: underline; }
    @media (pointer: coarse) { .hq-chip, .list a { min-height: 48px; } }
  `],
})
export class CodexPersonalUsesComponent {
  readonly ownership = input<HqOwnership | null>(null);
  readonly personal = input(false);
  readonly mineParams = { [HQ_MINE_PARAM]: '' };

  readonly count = computed(() => {
    const o = this.ownership();
    return o ? o.equippedOn.length + o.inSets.length : 0;
  });

  shipLink(className: string, configId: string): HqLink {
    return personalShipLink(className, configId);
  }

  setLink(id: string): string[] {
    return hqSet(id);
  }
}
