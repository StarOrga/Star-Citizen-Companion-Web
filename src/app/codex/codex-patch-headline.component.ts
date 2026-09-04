import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexService } from './codex.service';
import { formatNumber } from './codex-format';
import {
  PatchTimelineEntry,
  latestPatches,
  mergePublishedPatches,
} from './codex-patch-timeline';
import { NewsService } from '../news/news.service';

/**
 * The Codex headline: "which patch am I looking at" (admin feedback 463872dd).
 *
 * It began as "Verse online" — a statement about our own archive dressed up as
 * a statement about the game — and was first merged with the playable state so
 * the two could not disagree. Round two of the same feedback retired that half
 * again: the header chip in the top right already reports "Spielbar" on every
 * page, so repeating it here said the same thing twice and stole the line from
 * the one fact only this page can give — the patch everything below was read
 * from.
 *
 * The patch is also the page's quiet time machine: the current patch is always
 * the visible label, and clicking it opens a discreet list of the last THREE
 * patches. Patches we hold catalog data for are selectable and switch the whole
 * Codex to that build; patches we have no data for are listed but greyed out
 * and inert, because selecting one would show an empty archive. Deliberately
 * understated — no hot accent, no glow, no headline typography: this is a
 * switch, not the point of the page.
 *
 * Round three (admin feedback f68c6c6b) cut it back to what it is:
 *   · the "Live" badge is gone — it read as "you are looking at the live game"
 *     while it only ever meant "this is the newest patch we know";
 *   · a patch RSI already shipped without a data upload is listed greyed out,
 *     sourced from the Verse-News patch notes the shell already holds (no new
 *     request, no new external dependency — see mergePublishedPatches);
 *   · the list is capped at three, so the pager is gone with it.
 */
@Component({
  selector: 'sc-codex-patch-headline',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Class names kept from the retired inline pill: same slot, same weight
         in the terminal row. Playability is NOT repeated here — the header chip
         says it once, app-wide. -->
    <div class="status-pill" [class.stale]="svc.stale()" [class.past]="svc.viewingPastPatch()">
      @if (svc.build(); as b) {
        <button
          #trigger
          type="button"
          class="status-patch patch-trigger mono"
          [class.on]="open()"
          (click)="toggle()"
          [attr.aria-expanded]="open()"
          aria-haspopup="listbox"
          [attr.aria-controls]="panelId"
          [attr.aria-label]="'codex.landing.patchSwitch.trigger' | translate: { patch: b.patchVersion }"
        >
          <span class="patch-label">{{
            'codex.landing.status.patch' | translate: { patch: b.patchVersion }
          }}</span>
          @if (svc.viewingPastPatch()) {
            <span class="patch-past">{{ 'codex.landing.patchSwitch.past' | translate }}</span>
          }
          <span class="patch-chev" [class.on]="open()" aria-hidden="true">▾</span>
        </button>
      }

      @if (svc.stale()) {
        <a class="status-stale" routerLink="/uploader">{{
          'codex.landing.status.stale' | translate
        }}</a>
      }

      @if (open()) {
        <div
          #pop
          class="patch-pop"
          [id]="panelId"
          role="dialog"
          tabindex="-1"
          [attr.aria-label]="'codex.landing.patchSwitch.title' | translate"
        >
          <span class="pop-label">{{ 'codex.landing.patchSwitch.title' | translate }}</span>

          @if (loading()) {
            <p class="pop-state">{{ 'codex.landing.patchSwitch.loading' | translate }}</p>
          } @else if (visible().length === 0) {
            <p class="pop-state">{{ 'codex.landing.patchSwitch.empty' | translate }}</p>
          } @else {
            <ul class="patch-list" role="listbox">
              @for (e of visible(); track e.patchVersion) {
                <li>
                  <button
                    type="button"
                    role="option"
                    class="patch-row"
                    [class.selected]="isSelected(e)"
                    [class.nodata]="!e.hasData"
                    [attr.aria-selected]="isSelected(e)"
                    [disabled]="!e.hasData"
                    [attr.aria-disabled]="!e.hasData"
                    [attr.title]="rowTitle(e)"
                    (click)="choose(e)"
                  >
                    <span class="row-ver mono">{{ e.patchVersion }}</span>
                    <!-- The marking the admin asked for: never colour alone —
                         every row says in words whether we hold data for it,
                         and the state rides on aria-disabled as well. -->
                    <span class="row-data" [class.has]="e.hasData">{{ dataLabel(e) | translate: dataArgs(e) }}</span>
                  </button>
                </li>
              }
            </ul>

            @if (svc.viewingPastPatch()) {
              <button type="button" class="patch-back" (click)="backToCurrent()">
                {{ 'codex.landing.patchSwitch.backToCurrent' | translate }}
              </button>
            }
          }

          <p class="pop-note">{{ 'codex.landing.patchSwitch.note' | translate }}</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; position: relative; }
      .mono { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-variant-numeric: tabular-nums; }

      /* ── the merged headline pill ─────────────────────────────────────── */
      .status-pill {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 3px;
        font-family: var(--sc-font-display);
        font-size: max(0.7rem, var(--sc-fs-floor, 0.68rem));
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--sc-fg-1);
        /* The pill talks about the ARCHIVE now, not about the game, so it rests
           in the neutral chrome instead of borrowing the playability green. */
        border: 1px solid var(--sc-border);
        background: var(--sc-bg-1);
      }
      .status-pill.stale {
        border-color: color-mix(in srgb, var(--sc-warning, #ffc14d) 40%, transparent);
        background: color-mix(in srgb, var(--sc-warning, #ffc14d) 10%, transparent);
      }
      /* Looking at an older patch is a neutral fact, not a fault: the pill says
         so with the accent it uses everywhere else, never with a warning. */
      .status-pill.past {
        border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
      }

      .status-stale { color: var(--sc-warning, #ffc14d); text-decoration: underline; }

      /* ── the patch switch trigger ─────────────────────────────────────── */
      .patch-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 6px;
        margin: -3px -4px;
        border: 1px solid transparent;
        border-radius: 3px;
        background: transparent;
        color: var(--sc-fg-2);
        font: inherit;
        text-transform: none;
        letter-spacing: 0;
        cursor: pointer;
        transition: color 0.16s ease, border-color 0.16s ease, background 0.16s ease;
      }
      .patch-trigger:hover,
      .patch-trigger:focus-visible,
      .patch-trigger.on {
        outline: none;
        color: var(--sc-fg-0);
        border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border));
        background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
      }
      .patch-past {
        font-family: var(--sc-font-display);
        font-size: max(0.6rem, var(--sc-fs-floor));
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--sc-accent);
      }
      .patch-chev { font-size: 0.62rem; transition: transform 0.16s ease; }
      .patch-chev.on { transform: rotate(180deg); }

      /* ── the dropdown ─────────────────────────────────────────────────── */
      .patch-pop {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        z-index: 80;
        width: min(300px, calc(100vw - 32px));
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 14px;
        border-radius: 10px;
        background: var(--sc-bg-1);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
        text-transform: none;
        letter-spacing: 0;
        animation: patch-in 0.14s ease-out both;
      }
      .patch-pop:focus { outline: none; }
      @keyframes patch-in {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: none; }
      }

      .pop-label {
        font-family: var(--sc-font-display);
        font-size: max(0.66rem, var(--sc-fs-floor));
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      .pop-state { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .pop-note {
        margin: 0;
        font-size: max(0.66rem, var(--sc-fs-floor));
        color: var(--sc-fg-2);
        line-height: 1.4;
        opacity: 0.85;
      }

      .patch-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
      .patch-row {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 40px;
        padding: 7px 9px;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--sc-fg-1);
        font: inherit;
        font-size: max(0.78rem, var(--sc-fs-floor));
        text-align: left;
        cursor: pointer;
        transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
      }
      .patch-row:hover:not([disabled]),
      .patch-row:focus-visible {
        outline: none;
        color: var(--sc-fg-0);
        border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
        background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
      }
      .patch-row.selected {
        color: var(--sc-fg-0);
        border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border));
        background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
      }
      /* No data = nothing to switch to. Dimmed AND disabled AND labelled. */
      .patch-row.nodata { cursor: default; color: var(--sc-fg-2); opacity: 0.62; }

      .row-ver { flex: 1 1 auto; min-width: 0; }
      .row-data {
        font-size: max(0.66rem, var(--sc-fs-floor));
        color: var(--sc-fg-2);
        white-space: nowrap;
      }
      .row-data.has { color: color-mix(in srgb, var(--sc-success, #5fd698) 75%, var(--sc-fg-1)); }

      .patch-back {
        align-self: flex-start;
        padding: 6px 8px;
        min-height: 36px;
        border: 1px solid var(--sc-border);
        border-radius: 6px;
        background: transparent;
        color: var(--sc-fg-1);
        font: inherit;
        font-size: max(0.72rem, var(--sc-fs-floor));
        cursor: pointer;
      }
      .patch-back:hover,
      .patch-back:focus-visible {
        outline: none;
        color: var(--sc-fg-0);
        border-color: var(--sc-accent);
        background: color-mix(in srgb, var(--sc-accent) 10%, transparent);
      }

      @media (pointer: coarse) {
        .patch-trigger { min-height: 40px; }
        .patch-row, .patch-back { min-height: 48px; }
      }
      @media (max-width: 420px) {
        .patch-pop { right: auto; left: 0; width: min(300px, calc(100vw - 24px)); }
      }
      @media (prefers-reduced-motion: reduce) {
        .patch-pop { animation: none; }
        .patch-chev { transition: none; }
      }
    `,
  ],
})
export class CodexPatchHeadlineComponent {
  readonly svc = inject(CodexService);
  private readonly news = inject(NewsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Fired after the active build changed, so the host can reload its data. */
  readonly patchChange = output<void>();

  readonly panelId = 'codex-patch-switch';
  readonly open = signal(false);
  readonly loading = signal(false);

  private readonly triggerEl = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly popEl = viewChild<ElementRef<HTMLElement>>('pop');

  /**
   * Patch lines RSI has already taken LIVE, from the Verse-News feed. The
   * shell's status chip keeps that feed loaded on every route, so reading it
   * here is free — and while it is empty (feed still in flight, or blocked) the
   * switch simply shows what our own archive knows.
   *
   * Main lines only (`4.10`, not `4.10.1`): every hotfix as its own greyed row
   * would push the patches we DO hold data for out of a three-row list.
   */
  readonly publishedPatches = computed<string[]>(() =>
    this.news
      .patchLines()
      .filter((g) => g.hasLive)
      .map((g) => g.line),
  );

  readonly visible = computed<readonly PatchTimelineEntry[]>(() =>
    latestPatches(mergePublishedPatches(this.svc.patchTimeline(), this.publishedPatches())),
  );

  constructor() {
    effect(() => {
      const pop = this.popEl();
      if (this.open() && pop) pop.nativeElement.focus();
    });
  }

  toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    void this.loadOnce();
  }

  close(returnFocus = true): void {
    if (!this.open()) return;
    this.open.set(false);
    if (returnFocus) this.triggerEl()?.nativeElement.focus();
  }

  /** Is this the patch the page is currently reading from? */
  isSelected(e: PatchTimelineEntry): boolean {
    const active = this.svc.build();
    return !!active && !!e.build && e.build.id === active.id;
  }

  /** Switch to a patch. A data-less entry is inert (and already `disabled`). */
  choose(e: PatchTimelineEntry): void {
    if (!e.hasData || !e.build) return;
    const changed = this.svc.selectBuild(e.build);
    this.close();
    if (changed) this.patchChange.emit();
  }

  /** Back to the newest patch we hold data for — the page's default. */
  backToCurrent(): void {
    const changed = this.svc.selectBuild(null);
    this.close();
    if (changed) this.patchChange.emit();
  }

  /** Data marking, in words: record count when we know it, else a plain verdict. */
  dataLabel(e: PatchTimelineEntry): string {
    if (!e.hasData) return 'codex.landing.patchSwitch.noData';
    return e.recordCount != null
      ? 'codex.landing.patchSwitch.hasDataCount'
      : 'codex.landing.patchSwitch.hasData';
  }

  dataArgs(e: PatchTimelineEntry): Record<string, string> {
    return { count: e.recordCount != null ? formatNumber(e.recordCount) : '' };
  }

  /** Technical provenance belongs in the tooltip, not on the row. */
  rowTitle(e: PatchTimelineEntry): string | null {
    return e.extractedAt ? `${e.patchVersion} · ${e.extractedAt}` : null;
  }

  private async loadOnce(): Promise<void> {
    if (this.svc.patchTimeline().length > 0) return;
    this.loading.set(true);
    try {
      await this.svc.loadPatchTimeline();
    } finally {
      this.loading.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this.close(false);
  }
}
