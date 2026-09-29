import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** One material of a crafting recipe, already labelled by codex-detail. */
export interface RecipeViewRow {
  key: number;
  name: string;
  /** The slot the material fills, or null when the row names none. */
  role: string | null;
  /** Formatted amount (SCU), or null when the recipe gives none. */
  qty: string | null;
  /** Formatted quality floor, or null when the floor rules nothing out. */
  minQuality: string | null;
}

/** The recipe that produces the open entity (#187), ready to render. */
export interface RecipeView {
  /** Formatted craft time, or null when the blueprint states none. */
  craftTime: string | null;
  blueprintSlug: string;
  rows: RecipeViewRow[];
}

/**
 * "Crafted from" card of the codex detail page (#187: which materials does
 * this cost). Shared by the classic view and the Holotable drawer (AUD-090,
 * AUD-116). codex-detail builds the labelled view (recipeView), so this card
 * only renders; the blueprint link stays a real anchor.
 */
@Component({
  selector: 'sc-codex-recipe-card',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <h2>
        {{ 'codex.detail.craftedFrom' | translate }}
        @if (recipe().craftTime != null) { <span class="ct">{{ recipe().craftTime }}</span> }
      </h2>
      <p class="hint">{{ 'codex.detail.craftedFromHint' | translate }}</p>
      @if (recipe().rows.length > 0) {
        <ul class="compat-list">
          @for (i of recipe().rows; track i.key) {
            <li>
              <span class="compat-link plain">{{ i.name }}</span>
              <span class="compat-meta">
                @if (i.role; as role) { <span class="chip subtle">{{ role }}</span> }
                @if (i.qty != null) { <span class="chip">{{ i.qty }} SCU</span> }
                @if (i.minQuality != null) { <span class="chip subtle">{{ 'codex.detail.minQuality' | translate: { value: i.minQuality } }}</span> }
              </span>
            </li>
          }
        </ul>
      } @else {
        <p class="muted">{{ 'codex.detail.noIngredients' | translate }}</p>
      }
      <a class="compat-link" [routerLink]="['/codex', 'blueprint', recipe().blueprintSlug]">
        {{ 'codex.detail.openBlueprint' | translate }}
      </a>
    </section>
  `,
  styles: [`
    :host { display: contents; }
    /* Card chrome and title of this page, as codex-detail draws its cards. */
    .sc-card { border-radius: 4px; box-shadow: none; }
    .block { padding: 16px 18px; }
    .block h2 { margin: 0 0 12px; font-size: max(10.5px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .block h2 .ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: max(0.74rem, var(--sc-fs-floor)); }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.82rem; }
    .chip { font-size: max(10px, var(--sc-fs-floor)); padding: 0 3px; border-radius: 2px; background: transparent; color: var(--sc-fg-1); border: 1px solid var(--sc-border); white-space: nowrap; }
    .chip.subtle { color: var(--sc-fg-2); }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
    .compat-link:hover { text-decoration: underline; }
    /* A raw resource has no codex page of its own, so it is listed as plain
       text — a dead link would be worse than no link. */
    .compat-link.plain { color: var(--sc-fg-0); }
    .compat-link.plain:hover { text-decoration: none; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }
  `],
})
export class CodexRecipeCardComponent {
  readonly recipe = input.required<RecipeView>();
}
