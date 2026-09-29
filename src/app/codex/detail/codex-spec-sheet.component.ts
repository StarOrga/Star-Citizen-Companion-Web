import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import type { SpecSection } from '../codex-format';

/** Where a catalog record was extracted from (payload.source). */
export interface SpecProvenance {
  channel: string;
  patch: string;
  build: string;
}

/**
 * The last card of the codex detail page: the full spec sheet (collapsed)
 * and the raw payload. Shared by the classic view and the Holotable drawer
 * (AUD-090, AUD-116). Whether either fold is open stays in codex-detail, so
 * it survives a switch between the two views.
 */
@Component({
  selector: 'sc-codex-spec-sheet',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block raw-block">
      <div class="spec-toggles">
        @if (sections().length > 0) {
          <button type="button" class="raw-toggle" (click)="toggleSpec.emit()">
            {{ (showSpec() ? 'codex.detail.hideFullSpec' : 'codex.detail.showFullSpec') | translate }}
          </button>
        }
        <button type="button" class="raw-toggle" (click)="toggleRaw.emit()">
          {{ (showRaw() ? 'codex.detail.hideRaw' : 'codex.detail.showRaw') | translate }}
        </button>
      </div>
      @if (showSpec()) {
        <div class="spec">
          @for (sec of sections(); track sec.title) {
            @if (sec.title) { <h3 class="sg-head">{{ sec.title }}</h3> }
            <table class="spec-table">
              <tbody>
                @for (r of sec.rows; track r.key) {
                  <tr>
                    <td class="sp-key">{{ r.key }}</td>
                    <td class="sp-val">{{ r.value }}@if (r.unit) {<span class="s-unit"> {{ r.unit }}</span>}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
          @if (provenance(); as p) {
            <p class="spec-prov">{{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}</p>
          }
        </div>
      }
      @if (showRaw()) { <pre class="raw">{{ rawJson() }}</pre> }
    </section>
  `,
  styles: [`
    :host { display: contents; }
    /* Card chrome of this page (codex-detail scopes the same rule to its own
       cards): a 4px corner, no glow. */
    .sc-card { border-radius: 4px; box-shadow: none; }
    .block { padding: 16px 18px; }
    .raw-block { padding-top: 14px; }
    .spec-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
    .raw-toggle { padding: 7px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer; }
    .raw-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .spec { margin-top: 12px; }
    .sg-head { margin: 14px 0 8px; font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; gap: 8px; }
    .sg-head::after { content: ''; flex: 1; height: 1px; background: var(--sc-border); }
    .sg-head:first-of-type { margin-top: 0; }
    .spec-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 4px; }
    .spec-table td { padding: 5px 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .sp-key { color: var(--sc-fg-2); width: 45%; overflow-wrap: anywhere; }
    .sp-val { color: var(--sc-fg-0); font-family: var(--sc-font-display); overflow-wrap: anywhere; }
    .s-unit { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: system-ui, sans-serif; }
    .spec-prov { margin: 10px 0 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .raw { margin: 12px 0 0; padding: 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-size: max(0.74rem, var(--sc-fs-floor)); overflow: auto; max-height: 460px; }
  `],
})
export class CodexSpecSheetComponent {
  readonly sections = input.required<readonly SpecSection[]>();
  readonly showSpec = input(false);
  readonly showRaw = input(false);
  readonly rawJson = input('');
  readonly provenance = input<SpecProvenance | null>(null);

  readonly toggleSpec = output<void>();
  readonly toggleRaw = output<void>();
}
