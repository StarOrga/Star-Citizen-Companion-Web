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
import { DesktopCapabilityService } from '../core/desktop-capability.service';
import { NewsService, StatusLevel, effectivePlayability } from './news.service';

const RSI_STATUS_URL = 'https://status.robertsspaceindustries.com/';

/**
 * The Companion desktop app's never-stale installer.
 *
 * `scc-app-latest` is an ALIAS release on the public binaries mirror carrying a
 * version-less asset name, exactly like `wallpaper-app-latest` (Starscape) and
 * `browser-extension-latest` (the hangar extension): every `v*` release of the
 * app repo republishes it, so this fixed URL always hands out the newest build
 * and the website never has to know a version number.
 */
const SCC_INSTALLER_URL =
  'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/scc-app-latest/SCC-Standalone-Setup.exe';

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

            <!-- "The verse is playable" is the moment you go and play, so this
                 is where the desktop Companion is offered. A public download in
                 the normal accent (not the hot one — that marks surfaces a
                 normal user never reaches), pointing at the never-stale alias
                 asset so the link cannot go stale between releases.

                 Hidden on a device that cannot install a Windows application at
                 all — same rule the desktop download menu follows (admin
                 feedback dccdcc82): a 400 MB installer offered on a phone is
                 noise, and the status panel keeps working without it. -->
            @if (canInstall()) {
              <a
                class="app-dl"
                [href]="sccInstallerUrl"
                target="_blank"
                rel="noopener noreferrer"
                download
                (click)="onDownload()">
                <span class="dl-arrow" aria-hidden="true">↓</span>
                <span class="dl-text">
                  <strong>{{ 'news.status.appDownload.label' | translate }}</strong>
                  <span class="dl-hint">{{ 'news.status.appDownload.hint' | translate }}</span>
                </span>
              </a>
            }
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
      font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase;
      white-space: nowrap;
      transition: border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }
    .vs-chip:hover { border-color: var(--sc-accent); }
    .vs-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.35); }
    /* "Everything is fine" is the state you should be able to IGNORE, so the
       operational chip carries no ring and no glow — only a problem earns the
       eye (admin feedback 4e54ad2c round 3: "grüner punkt ... viel zu
       auffällig"). Degraded and outage keep their coloured rings. */
    .vs-chip.status-degraded, .vs-chip.status-partial_outage,
    .vs-chip.status-maintenance { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-warning) 40%, transparent); }
    .vs-chip.status-major_outage { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-danger) 40%, transparent); }

    .dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: var(--sc-fg-2); flex: 0 0 auto;
    }
    /* Muted green, no halo: still unmistakably "green = playable", but it sits in
       the header instead of announcing itself. */
    .dot.status-operational { background: color-mix(in srgb, var(--sc-success) 72%, var(--sc-bg-1)); }
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
      margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .svc-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; }
    .svc-list li {
      display: flex; align-items: center; gap: 8px; font-size: 0.82rem;
      padding: 4px 6px; border-radius: 4px; background: var(--sc-bg-1);
    }
    .svc-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .svc-status { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.06em; }
    .muted { color: var(--sc-fg-2); font-size: 0.82rem; margin: 0; }
    .ext-link { font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-accent); }

    /* Sits under a hairline: the panel answers "is it up?", and the download is
       the next step, not part of the answer. */
    .app-dl {
      display: flex; align-items: center; gap: 10px;
      margin-top: 2px; padding: 9px 10px;
      border: 1px solid var(--sc-border); border-radius: 6px;
      background: var(--sc-bg-1); color: var(--sc-fg-0);
      text-decoration: none;
      transition: border-color .18s ease, background .18s ease;
    }
    .app-dl:hover { border-color: var(--sc-accent); background: var(--sc-bg-2); }
    .app-dl:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .dl-arrow { color: var(--sc-accent); font-size: 0.95rem; flex: 0 0 auto; }
    .dl-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .dl-text strong { font-size: 0.82rem; font-weight: 600; }
    .dl-hint { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    /* Phones: the label eats the row the nav needs, so only the dot survives. */
    @media (max-width: 720px) {
      .vs-label { display: none; }
      /* Label-less, the dot is the whole control — so it gets smaller, not
         louder. A glowing 9px disc next to the search was the single most
         eye-catching thing in the mobile header. */
      .dot { width: 8px; height: 8px; }
      /* And the pill goes with the label. A rounded frame is a "chip" — a thing
         with a name in it; wrapped around a single 8px dot it is just a box
         drawn around a mark, the same shape the search trigger next to it was
         asked to drop (admin feedback 4e54ad2c round 3). Without it the header
         reads as two quiet glyphs. The control grows to a real 48px target in
         the process: at 7px/9px padding it measured ~26x24, well under the
         touch minimum the rest of the app holds itself to. */
      .vs-chip {
        padding: 0; gap: 0; justify-content: center;
        min-width: 48px; min-height: 48px;
        background: transparent; border-color: transparent;
      }
      .vs-chip:hover { border-color: transparent; }
      .vs-chip:focus-visible {
        box-shadow: none; outline: 2px solid var(--sc-accent); outline-offset: -4px;
      }
    }
  `],
})
export class VerseStatusChipComponent implements OnInit {
  private readonly svc = inject(NewsService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly device = inject(DesktopCapabilityService);

  readonly rsiStatusUrl = RSI_STATUS_URL;
  readonly sccInstallerUrl = SCC_INSTALLER_URL;
  /** Can this device install a downloaded Windows application at all? */
  readonly canInstall = this.device.canInstall;
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

  /**
   * Collapse once a download is under way — the app's rule for every download
   * control (see `AppDownloadMenuComponent.onDownload`). The anchor itself is
   * untouched, so middle-click and "open in new tab" keep working and simply
   * leave the panel closed behind them.
   */
  onDownload(): void {
    this.open.set(false);
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
