import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { NewsService, StatusLevel, effectivePlayability } from './news.service';

const RSI_STATUS_URL = 'https://status.robertsspaceindustries.com/';

/**
 * How often the header chip re-checks the verse status, and how old the feed
 * may be before it bothers. The Verse-News page polls the same feed every 5
 * minutes while it is open, so the staleness guard makes this a no-op there
 * instead of doubling the request rate.
 */
const CHECK_INTERVAL_MS = 60 * 1000;
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * "Is Star Citizen playable right now" — the header's server-status indicator.
 *
 * Used to live in the Verse-News page header; the admin asked for it in the top
 * bar next to the search instead (feedback #79), because the answer is what you
 * open the app for and it should not depend on which route you are on. The
 * drill-down (per-service list + link to RSI's status page) rides along as a
 * dropdown, so nothing was lost in the move.
 */
@Component({
  selector: 'sc-verse-status-chip',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status(); as st) {
      @let eff = level();
      <div class="vs">
        <button
          type="button"
          class="vs-chip"
          [class]="'vs-chip status-' + eff"
          [attr.aria-expanded]="open()"
          [attr.aria-label]="('news.status.title' | translate) + ': ' + (('news.status.' + eff) | translate)"
          (click)="toggle($event)">
          <span class="dot" [class]="'status-' + eff" aria-hidden="true"></span>
          <span class="vs-label">{{ ('news.status.' + eff) | translate }}</span>
        </button>

        @if (open()) {
          <div class="vs-panel" role="dialog" [attr.aria-label]="'news.status.services' | translate">
            <h3>{{ 'news.status.services' | translate }}</h3>
            @if (st.components.length > 0) {
              <ul class="svc-list">
                @for (c of st.components; track c.name) {
                  <li>
                    <span class="dot" [class]="'status-' + c.status" aria-hidden="true"></span>
                    <span class="svc-name">{{ c.name }}</span>
                    <span class="svc-status">{{ ('news.status.' + c.status) | translate }}</span>
                  </li>
                }
              </ul>
            } @else {
              <p class="muted">{{ 'news.status.noComponents' | translate }}</p>
            }
            <a class="ext-link" [href]="rsiStatusUrl" target="_blank" rel="noopener noreferrer">
              {{ 'news.status.checkExternal' | translate }}
            </a>
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .vs { position: relative; display: inline-flex; }

    .vs-chip {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 7px 12px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      color: var(--sc-fg-0); cursor: pointer;
      font-family: var(--sc-font-display);
      font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase;
      white-space: nowrap;
      transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }
    .vs-chip:hover { border-color: var(--sc-accent); }
    .vs-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }
    .vs-chip.status-operational { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 40%, transparent); }
    .vs-chip.status-degraded, .vs-chip.status-partial_outage,
    .vs-chip.status-maintenance { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .vs-chip.status-major_outage { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-danger) 40%, transparent); }

    .dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--sc-fg-2); flex: 0 0 auto;
    }
    .dot.status-operational { background: var(--sc-success); box-shadow: 0 0 8px var(--sc-success); }
    .dot.status-degraded, .dot.status-partial_outage { background: var(--sc-warning); }
    .dot.status-major_outage { background: var(--sc-danger); box-shadow: 0 0 8px var(--sc-danger); }
    .dot.status-maintenance { background: var(--sc-accent); }
    .dot.status-unknown { background: var(--sc-fg-2); }

    .vs-panel {
      position: absolute; top: calc(100% + 8px); right: 0;
      z-index: 30; width: max-content; max-width: min(360px, calc(100vw - 24px));
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px 14px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      border: 1px solid var(--sc-border); border-radius: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), var(--sc-glow);
    }
    .vs-panel h3 {
      margin: 0; font-size: 0.72rem; color: var(--sc-fg-2);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .svc-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; }
    .svc-list li {
      display: flex; align-items: center; gap: 8px; font-size: 0.82rem;
      padding: 4px 6px; border-radius: 4px; background: var(--sc-bg-1);
    }
    .svc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .svc-status { font-size: 0.7rem; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.06em; }
    .muted { color: var(--sc-fg-2); font-size: 0.82rem; margin: 0; }
    .ext-link { font-size: 0.78rem; color: var(--sc-accent); }

    /* Phones: the label eats the row the nav needs, so only the dot survives. */
    @media (max-width: 720px) {
      .vs-chip { padding: 7px 9px; gap: 0; }
      .vs-label { display: none; }
    }
  `],
})
export class VerseStatusChipComponent implements OnInit {
  private readonly svc = inject(NewsService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly rsiStatusUrl = RSI_STATUS_URL;
  readonly open = signal(false);

  readonly status = computed(() => this.svc.feed()?.status ?? null);
  /**
   * Playability-aware headline (see {@link effectivePlayability}): a scheduled
   * Persistent-Universe maintenance must not read as "Playable" just because
   * RSI's overall indicator stayed green (feedback 740d31cb).
   */
  readonly level = computed<StatusLevel>(() => {
    const st = this.status();
    return st ? effectivePlayability(st) : 'unknown';
  });

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
    });
  }

  ngOnInit(): void {
    this.refreshIfStale();
    this.timer = setInterval(() => this.refreshIfStale(), CHECK_INTERVAL_MS);
  }

  /**
   * Only fetch when nobody else already did. The chip lives in the shell, so it
   * is mounted on every route — but the Verse-News page keeps the very same feed
   * fresh while it is open, and a second poller would just double the traffic.
   */
  private refreshIfStale(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const fetched = this.svc.feed()?.fetchedAt;
    const age = fetched ? Date.now() - Date.parse(fetched) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(age) && age < STALE_AFTER_MS) return;
    void this.svc.refresh(true);
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.open.update((v) => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open()) return;
    const el = (this.host.nativeElement as HTMLElement).querySelector('.vs');
    if (el && !el.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open()) this.open.set(false);
  }
}
