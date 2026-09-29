import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { CodexKind } from '../codex.service';

/** One pickable record of a skin or edition family. */
export interface VariantPickerOption {
  classNameSlug: string;
  /** Livery / edition name, or null for the base record ("Standard"). */
  label: string | null;
}

/**
 * The skin picker (feedback d5e39f86) and the edition picker (feedback
 * 77ecad2a) of the codex detail page, extracted from codex-detail (AUD-090,
 * AUD-116) where the same block stood six times: hero body, tool row and the
 * Holotable drawer, once per variant.
 *
 * A native details for the fold; every option is a real anchor to that
 * record's own detail route, so a livery keeps a shareable URL and a middle
 * click still opens a tab. The parent keeps the "more than one option" gate
 * and the order per place; this component only renders.
 *
 * Host is display:contents so the details sits in the parent's flex row
 * exactly as before. In the tool row the parent sets the host class
 * in-toolrow, which switches on the compact tool-row sizing.
 */
@Component({
  selector: 'sc-codex-variant-picker',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="picker" [class.edition-picker]="variant() === 'edition'" [class.skin-picker]="variant() === 'skin'">
      <summary>
        <span class="sp-label">{{ (prefix() + '.label') | translate }}</span>
        <span class="sp-current">{{ current() ?? ((prefix() + '.standard') | translate) }}</span>
        <span class="sp-count">{{ (prefix() + '.count') | translate: { count: options().length } }}</span>
      </summary>
      <ul class="sp-list">
        @for (o of options(); track o.classNameSlug) {
          <li>
            <a class="sp-opt"
               [class.current]="o.classNameSlug === currentSlug()"
               [attr.aria-current]="o.classNameSlug === currentSlug() ? 'true' : null"
               [routerLink]="['/codex', kind(), o.classNameSlug]">
              {{ o.label ?? ((prefix() + '.standard') | translate) }}
            </a>
          </li>
        }
      </ul>
    </details>
  `,
  styles: [`
    :host { display: contents; }
    .picker { margin-top: 10px; max-width: 320px; }
    .picker > summary {
      display: flex; align-items: center; gap: 8px; cursor: pointer;
      padding: 7px 12px; border-radius: 8px; list-style: none;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      transition: border-color 0.16s;
    }
    .picker > summary::-webkit-details-marker { display: none; }
    .picker > summary::after { content: '▾'; margin-left: auto; color: var(--sc-fg-2); }
    .picker[open] > summary::after { content: '▴'; }
    .picker > summary:hover { border-color: var(--sc-accent); }
    .picker > summary:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .sp-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .sp-current { font-size: max(0.82rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    .sp-count { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sp-list {
      list-style: none; margin: 4px 0 0; padding: 4px; max-height: 260px; overflow-y: auto;
      border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .sp-opt {
      display: block; padding: 7px 10px; border-radius: 6px;
      color: var(--sc-fg-1); text-decoration: none; font-size: max(0.82rem, var(--sc-fs-floor));
    }
    .sp-opt:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); }
    .sp-opt.current { color: var(--sc-accent); font-weight: 600; }

    /* Tool row (WERKZEUGZEILE): the concept has no picker of its own; its
       dropdown vocabulary is the mock select (part-02:193 select.m-sel): a 3px
       rectangle, 10.5px type, .25rem/.4rem of padding. The 48px touch floor
       stays for coarse pointers and only a mouse gets the drawn height. */
    :host(.in-toolrow) .picker { position: relative; margin-top: 0; max-width: 260px; }
    :host(.in-toolrow) .picker > summary { min-height: 48px; padding: 3px 6px; gap: 6px; border-radius: 3px; }
    @media (pointer: fine) {
      :host(.in-toolrow) .picker > summary { min-height: 24px; }
    }
    :host(.in-toolrow) .sp-label,
    :host(.in-toolrow) .sp-current,
    :host(.in-toolrow) .sp-count { font-size: max(10.5px, var(--sc-fs-floor)); }
    :host(.in-toolrow) .sp-list { position: absolute; z-index: 5; min-width: 240px; }
  `],
})
export class CodexVariantPickerComponent {
  readonly variant = input.required<'edition' | 'skin'>();
  readonly kind = input.required<CodexKind>();
  readonly currentSlug = input.required<string>();
  readonly options = input.required<readonly VariantPickerOption[]>();
  /** The open record's label, or null while the base record is open. */
  readonly current = input<string | null>(null);

  /** i18n prefix: codex.editionPicker.* or codex.skinPicker.* */
  protected readonly prefix = computed(() =>
    this.variant() === 'edition' ? 'codex.editionPicker' : 'codex.skinPicker',
  );
}
