import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LandingItem } from './codex-landing-data.types';
import { barOf, compareValue, splitCallouts, valueLabel, valueText } from './codex-landing-values';
import { CodexLandingCalloutSetService, hasLoadoutSet, valuesForSet } from './codex-landing-callout-set.service';
import { CodexLandingSetToggleComponent } from './codex-landing-set-toggle.component';

interface BarRow {
  key: string;
  label: string;
  text: string;
  bar: { fill: number; avg: number | null } | null;
  worse: boolean;
  /** Shown as a callout at the hologram on wide screens — listed here only where the callouts give way. */
  callout: boolean;
}

/**
 * The data sheet (round 4, design "Zugewandte Kante"): a light pane with no
 * box, only a glowing edge on its outer side, projected out of the screen edge. Bars for the
 * values that are not callouts (value vs. class mean, the mean as a yellow
 * tick), then the way to the detail page. Re-scans its content on every
 * rotation step.
 */
@Component({
  selector: 'sc-codex-landing-values-pane',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CodexLandingSetToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()' },
  template: `
    <span class="edge" aria-hidden="true"></span>
    @if (item(); as it) {
      @for (k of [key()]; track k) {
        <section class="body" [class.boot]="boot()" [attr.aria-label]="'codex.landing.values.more' | translate">
          <h2 class="ph">{{ 'codex.landing.values.more' | translate }}</h2>
          @if (canSwitch()) {
            <!-- Where the callouts give way (< 1100px), the Flug / Loadout switch moves here (#884). -->
            <sc-codex-landing-set-toggle class="set" />
          }
          @if (rows().length) {
            <dl class="rows">
              @for (r of rows(); track r.key; let i = $index) {
                <div class="row" [class.callout]="r.callout" [class.worse]="r.worse" [style.--i]="i">
                  <dt>{{ r.label }}</dt>
                  <dd class="flash">{{ r.text }}</dd>
                  @if (r.bar; as b) {
                    <span class="bar" aria-hidden="true">
                      <i [style.width.%]="b.fill"></i>
                      @if (b.avg !== null) { <u [style.left.%]="b.avg"></u> }
                    </span>
                  }
                </div>
              }
            </dl>
            @if (hasBars()) {
              <p class="legend"><u aria-hidden="true"></u>{{ 'codex.landing.values.legend' | translate }}</p>
            }
          }
          <a class="go" [routerLink]="it.detailRoute">{{ 'codex.landing.values.toPage' | translate: { name: it.name } }} <i aria-hidden="true">↗</i></a>
          <i class="sweep" aria-hidden="true"></i>
        </section>
      }
    }
  `,
  styles: [
    `
      :host { position: relative; display: flex; flex-direction: column; justify-content: flex-end; color: var(--sc-fg-1); --cx-mono: 'JetBrains Mono', 'Cascadia Mono', ui-monospace, Consolas, monospace; }
      .edge {
        position: absolute; right: 0; top: 0; bottom: 0; width: 1px; pointer-events: none;
        background: linear-gradient(180deg, transparent, rgba(170, 238, 255, 0.85) 18%, rgba(220, 250, 255, 1) 50%, rgba(170, 238, 255, 0.85) 82%, transparent);
        box-shadow: 0 0 10px rgba(130, 220, 255, 0.55);
      }
      /* The light fan from the screen edge: narrow at the edge, the full edge height at the line. */
      .edge::before {
        content: ''; position: absolute; left: 100%; top: 0; bottom: 0; width: var(--cx-bleed, 40px);
        background: linear-gradient(90deg, rgba(130, 222, 255, 0.07), rgba(82, 193, 230, 0.015) 55%, rgba(170, 238, 255, 0.08));
        clip-path: polygon(0 0, 0 100%, 100% 58%, 100% 42%);
      }
      /* The source slit where the fan leaves the screen edge. */
      .edge::after {
        content: ''; position: absolute; top: 42%; height: 16%; left: calc(100% + var(--cx-bleed, 40px) - 2px); width: 2px;
        background: rgba(220, 250, 255, 0.85); box-shadow: 0 0 12px 2px rgba(130, 220, 255, 0.7); border-radius: 1px;
      }
      .body {
        position: relative; display: flex; flex-direction: column; align-items: flex-start; text-align: left;
        min-height: 0; overflow: hidden;
        padding: 16px 18px 16px 0;
        background: repeating-linear-gradient(180deg, rgba(150, 230, 255, 0.035) 0 1px, transparent 1px 4px);
        clip-path: inset(0 0 100% 0);
        animation: pane-in 0.7s cubic-bezier(0.3, 0.6, 0.3, 1) var(--pane-at, 2.6s) both;
      }
      .body:not(.boot) { --pane-at: 1.5s; }
      .ph {
        margin: 0 0 14px; font: 600 max(10px, 0.62rem) / 1.2 var(--sc-font-display); letter-spacing: 0.24em;
        text-transform: uppercase; color: var(--sc-accent);
      }
      .set { display: none; margin: -6px 0 12px; }
      .rows { display: flex; flex-direction: column; gap: 12px; width: 100%; margin: 0; }
      /* The pane stands right of the stage: label toward the hologram, value at the outer edge. */
      .row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; column-gap: 10px; row-gap: 6px; }
      .row dt { grid-column: 1; grid-row: 1; justify-self: start; font: 600 max(9.5px, 0.6rem) / 1.2 var(--sc-font-display); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2); }
      .row dd { grid-column: 2; grid-row: 1; margin: 0; font: 600 max(13px, 0.86rem) / 1 var(--cx-mono); font-variant-numeric: tabular-nums; color: var(--sc-fg-0); white-space: nowrap; }
      .bar { grid-column: 1 / -1; position: relative; height: 3px; border-radius: 2px; background: rgba(82, 193, 230, 0.13); }
      .bar i {
        position: absolute; right: 0; top: 0; bottom: 0; border-radius: 2px;
        background: linear-gradient(270deg, rgba(82, 193, 230, 0.5), #8fe3ff);
        box-shadow: 0 0 6px rgba(130, 220, 255, 0.45);
        transform-origin: 100% 50%;
        animation: bar-in 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) calc(var(--pane-at, 2.6s) + 0.25s + var(--i) * 0.07s) both;
      }
      /* Bars grow out of the hologram's side (left) toward the screen edge. */
      .bar u { position: absolute; top: -3px; bottom: -3px; width: 1.5px; margin-left: -0.75px; background: var(--sc-warning); box-shadow: 0 0 4px color-mix(in srgb, var(--sc-warning) 70%, transparent); }
      .bar i { left: 0; right: auto; transform-origin: 0 50%; }
      .row.callout { display: none; }
      /* Past the sheet's height: only the button to the detail page carries the rest (fitRows). */
      .row.cut { display: none !important; }
      .row.worse .bar i { background: linear-gradient(90deg, color-mix(in srgb, var(--sc-warning) 45%, transparent), var(--sc-warning)); box-shadow: none; }
      .legend { display: flex; align-items: center; gap: 6px; margin: 12px 0 0; font-size: max(10px, 0.62rem); color: var(--sc-fg-2); }
      .legend u { display: inline-block; width: 1.5px; height: 10px; background: var(--sc-warning); }
      .go {
        display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; min-height: 34px; padding: 0 14px;
        border: 1px solid rgba(82, 193, 230, 0.55); border-radius: 4px; text-decoration: none;
        font: 600 max(11px, 0.72rem) / 1.2 var(--sc-font-body); color: var(--sc-accent);
        transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
      }
      .go:hover, .go:focus-visible { border-color: var(--sc-accent); background: rgba(82, 193, 230, 0.1); color: var(--sc-fg-0); }
      .go:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      /* The re-scan line: a body-tall track slides its top edge down (transform only). */
      .sweep {
        position: absolute; left: 0; right: 0; top: 0; height: 100%; pointer-events: none; opacity: 0;
        animation: sweep 0.75s linear var(--pane-at, 2.6s) both;
      }
      .sweep::before {
        content: ''; position: absolute; left: 0; right: 0; top: 0; height: 2px;
        background: linear-gradient(90deg, transparent, #eaffff 30%, transparent); box-shadow: 0 0 10px #8fe3ff;
      }
      .body:not(.boot) .flash { animation: flash 1.1s ease-out calc(var(--pane-at) + 0.45s) both; }
      @keyframes pane-in { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
      @keyframes sweep { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(100%); opacity: 0; } }
      @keyframes bar-in { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @keyframes flash { 0% { color: inherit; } 22% { color: #fff; text-shadow: 0 0 14px #8fe3ff, 0 0 3px #fff; } 100% { text-shadow: none; } }
      :host(.still) .body, :host(.still) .bar i, :host(.still) .sweep, :host(.still) .flash { animation: none; clip-path: none; }
      :host(.still) .sweep { display: none; }
      @media (prefers-reduced-motion: reduce) { .body, .bar i, .sweep, .flash { animation: none !important; clip-path: none; } .sweep { display: none; } }
      @media (max-width: 1099px) { .row.callout { display: grid; } .set { display: block; } }
      /* Touch screens: the dense holo labels stay readable and the link tappable (mobile gate). */
      @media (pointer: coarse) {
        .ph, .row dt, .legend { font-size: 12px; }
        .go { min-height: 48px; font-size: 12px; }
      }
      @media (max-width: 720px) {
        :host { justify-content: flex-start; }
        .edge { display: none; }
        .body { align-items: stretch; text-align: left; padding: 12px 0; }
        .row { grid-template-columns: 1fr auto; }
        .row dt { grid-column: 1; justify-self: start; }
        .row dd { grid-column: 2; }
        .bar { transform: none; }
        .bar u { transform: none; }
        .go { align-self: flex-start; }
      }
    `,
  ],
})
export class CodexLandingValuesPaneComponent {
  private readonly translate = inject(TranslateService);
  private readonly lang = this.translate.currentLang;
  private readonly calloutSet = inject(CodexLandingCalloutSetService);

  readonly item = input<LandingItem | null>(null);
  readonly switchNo = input(0);
  readonly still = input(false);

  readonly boot = computed(() => this.switchNo() === 0);
  readonly key = computed(() => {
    const it = this.item();
    return it ? `${it.category}:${it.className}` : '';
  });

  /** Bars for the non-callout values; the callout values follow (hidden where the callouts stand). */
  readonly rows = computed<BarRow[]>(() => {
    this.lang();
    const it = this.item();
    if (!it) return [];
    const { callouts, rest } = splitCallouts(it.category, valuesForSet(it, this.calloutSet.set()));
    const toRow = (v: (typeof rest)[number], callout: boolean): BarRow => ({
      key: v.key,
      label: valueLabel(this.translate, v.key),
      text: valueText(v),
      bar: barOf(v),
      worse: compareValue(v)?.worse ?? false,
      callout,
    });
    return [...rest.map((v) => toRow(v, false)), ...callouts.map((c) => toRow(c.value, true))];
  });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const destroy = inject(DestroyRef);
    // The sheet is as tall as the Codex column and never scrolls: the rows that do not fit are cut, lowest priority first.
    effect(() => {
      this.rows();
      this.canSwitch();
      requestAnimationFrame(() => this.fitRows());
    });
    afterNextRender(() => {
      const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.fitRows());
      ro?.observe(this.host.nativeElement);
      void document.fonts?.ready.then(() => this.fitRows());
      destroy.onDestroy(() => ro?.disconnect());
    });
  }

  /** Shows as many rows (in priority order) as the sheet's height holds; the "to the page" button always stays. */
  fitRows(): void {
    const body = this.host.nativeElement.querySelector<HTMLElement>('.body');
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>('.row'));
    for (const r of rows) r.classList.remove('cut');
    const go = body.querySelector<HTMLElement>('.go');
    // Not scrollHeight: the re-scan line (.sweep) travels below the body and would count as overflow.
    const over = (): boolean => !!go && go.getBoundingClientRect().bottom + (parseFloat(getComputedStyle(body).paddingBottom) || 0) > body.getBoundingClientRect().bottom + 1;
    const shown = rows.filter((r) => r.getClientRects().length > 0);
    for (let i = shown.length - 1; i >= 0 && over(); i--) shown[i].classList.add('cut');
    const legend = body.querySelector<HTMLElement>('.legend');
    if (legend) {
      const anyBar = shown.some((r) => !r.classList.contains('cut') && r.querySelector('.bar u'));
      legend.style.display = anyBar ? '' : 'none';
    }
  }

  readonly canSwitch = computed(() => hasLoadoutSet(this.item()));
  readonly hasBars = computed(() => this.rows().some((r) => !r.callout && r.bar?.avg !== null && !!r.bar));
}
