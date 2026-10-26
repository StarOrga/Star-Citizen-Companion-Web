import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import qrcode from 'qrcode-generator';
import { HandoffConnection, HandoffService, handoffTargetPath } from '../../core/handoff/handoff.service';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

/**
 * "Auf dem Handy weitermachen" (spec §11): round button bottom-left, hidden on
 * phones; the popup grows out of it with three steps, left to right.
 *
 * SHELL ONLY. The backend (`HandoffService`: code in the URL fragment,
 * explicit confirm on the phone, `listConnected()`, revoke) is reworked on
 * another branch. Until it is wired, the QR / status area is the
 * `[handoffStatus]` content slot (default: a clearly named placeholder), and
 * `step` says which of the three steps is current.
 */
@Component({
  selector: 'sc-handoff-button',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap">
      <button type="button" class="round" [attr.aria-expanded]="open()" aria-haspopup="dialog"
              [attr.aria-label]="'handoff.button' | translate"
              [scTooltip]="'handoff.button' | translate" scTooltipTier="label"
              (click)="toggle()">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="7" y="2.5" width="10" height="19" rx="2.2" /><path d="M11 18.5h2" />
        </svg>
      </button>
      @if (open()) {
        <div class="popup" scDialog role="dialog" [attr.aria-label]="'handoff.title' | translate"
             (keydown.escape)="close()">
          <p class="title">{{ 'handoff.title' | translate }}</p>
          <ol class="steps">
            @for (n of steps; track n) {
              <li [class.current]="step() === n">
                <span class="num" aria-hidden="true">{{ n }}</span>
                <span class="txt">{{ ('handoff.step' + n) | translate }}</span>
              </li>
            }
          </ol>
          <div class="status" aria-live="polite">
            @if (errorKey(); as key) {
              <p class="err" role="alert">{{ key | translate }}</p>
              <button type="button" class="btn" (click)="start()">{{ 'handoff.retry' | translate }}</button>
            } @else if (svc.status() === 'connected') {
              <p class="ok">{{ 'handoff.connected' | translate }}@if (svc.device(); as d) { <span class="dev">· {{ d }}</span>}</p>
              <p class="hint">{{ 'handoff.revoke.note' | translate }}</p>
              <button type="button" class="btn" (click)="revoke(null)">{{ 'handoff.revoke' | translate }}</button>
            } @else if (svc.status() === 'pending' && qr(); as src) {
              <img class="qr" [src]="src" [alt]="'handoff.qrAlt' | translate" width="160" height="160" />
              <p class="hint">{{ 'handoff.expires' | translate }}</p>
            } @else if (svc.status() === 'expired' || svc.status() === 'revoked') {
              <p class="hint">{{ (svc.status() === 'expired' ? 'handoff.expired' : 'handoff.revoked') | translate }}</p>
              <button type="button" class="btn" (click)="start()">{{ 'handoff.retry' | translate }}</button>
            } @else {
              <p class="hint">{{ 'handoff.loading' | translate }}</p>
            }
            @if (doneNote()) { <p class="hint">{{ 'handoff.revoke.done' | translate }}</p> }
          </div>
          @if (phones().length) {
            <div class="phones">
              <p class="sub">{{ 'handoff.devices' | translate }}</p>
              @for (ph of phones(); track ph.id) {
                <div class="phone">
                  <span>{{ ph.device ?? ('handoff.noDevice' | translate) }}</span>
                  <button type="button" class="btn small" (click)="revoke(ph.id)">{{ 'handoff.revoke' | translate }}</button>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }
    /* Stacked above the footer's badge (footer height + a step), never on it. */
    .wrap {
      position: fixed; z-index: 44;
      left: max(var(--sc-space-3), env(safe-area-inset-left));
      bottom: calc(var(--sc-footer-h) + var(--sc-space-3) + var(--sc-safe-bottom, 0px));
    }
    .round {
      width: 48px; height: 48px; display: grid; place-items: center; cursor: pointer;
      color: var(--sc-accent); border-radius: 50%; padding: 0;
      background: color-mix(in srgb, var(--sc-bg-1) 90%, transparent);
      border: 1px solid var(--sc-border); backdrop-filter: blur(8px);
      box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
    }
    .round:hover { border-color: var(--sc-accent); }
    .round:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .popup {
      position: absolute; left: 0; bottom: calc(100% + var(--sc-space-2));
      width: min(440px, calc(100vw - 2 * var(--sc-space-4)));
      padding: var(--sc-space-4); transform-origin: bottom left;
      background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent);
      border: 1px solid var(--sc-border); border-radius: 14px;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45); backdrop-filter: blur(10px);
      animation: grow 0.18s ease-out;
    }
    @keyframes grow { from { opacity: 0; transform: scale(0.85); } }
    .title { margin: 0 0 var(--sc-space-3); font-family: var(--sc-font-display); letter-spacing: 0.06em;
      text-transform: uppercase; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .steps { list-style: none; margin: 0 0 var(--sc-space-3); padding: 0; display: flex; gap: var(--sc-space-3); }
    .steps li { flex: 1 1 0; display: flex; flex-direction: column; gap: var(--sc-space-1);
      font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .steps li.current { color: var(--sc-fg-1); }
    .num { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center;
      border: 1px solid var(--sc-border); font-size: max(0.7rem, var(--sc-fs-floor)); }
    .current .num { border-color: var(--sc-accent); color: var(--sc-accent); }
    .status { min-height: 120px; display: grid; place-items: center; text-align: center;
      border: 1px dashed var(--sc-border); border-radius: 10px; padding: var(--sc-space-3);
      color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
    .qr { width: 160px; height: 160px; background: #fff; border-radius: 8px; }
    .status { gap: var(--sc-space-2); align-content: center; justify-items: center; }
    .status p { margin: 0; }
    .ok { color: var(--sc-accent); font-weight: 600; }
    .err { color: var(--sc-danger); }
    .hint, .dev { color: var(--sc-fg-2); }
    .btn { min-height: var(--sc-tap-min); padding: 0 var(--sc-space-3); cursor: pointer; font: inherit;
      color: var(--sc-fg-1); background: none; border: 1px solid var(--sc-border); border-radius: 999px; }
    .btn:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .phones { margin-top: var(--sc-space-3); }
    .sub { margin: 0 0 var(--sc-space-1); color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .phone { display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3);
      font-size: max(0.78rem, var(--sc-fs-floor)); }
    /* Phones (the bar's breakpoint): the bar sits at the bottom, the QR hand-off is for the desk. */
    @media (max-width: 720px) { .wrap { display: none; } }
    @media (prefers-reduced-motion: reduce) { .popup { animation: none; } }
  `],
})
export class HandoffButtonComponent implements OnDestroy {
  protected readonly svc = inject(HandoffService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly steps = [1, 2, 3] as const;
  protected readonly open = signal(false);
  protected readonly errorKey = signal<string | null>(null);
  protected readonly phones = signal<HandoffConnection[]>([]);
  protected readonly doneNote = signal(false);
  /** 1 scan, 2 confirm (happens on the phone, not observable), 3 connected. */
  protected readonly step = computed(() => (this.svc.status() === 'connected' ? 3 : 1));
  /** The QR is the current code's URL as an SVG data URL (the code lives in the fragment). */
  protected readonly qr = computed(() => {
    const cur = this.svc.current();
    if (!cur) return null;
    const q = qrcode(0, 'M');
    q.addData(cur.url);
    q.make();
    return `data:image/svg+xml;utf8,${encodeURIComponent(q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))}`;
  });

  protected toggle(): void {
    if (this.open()) this.close();
    else {
      this.open.set(true);
      void this.start();
    }
  }

  protected close(): void {
    this.open.set(false);
    this.svc.stopWatching();
  }

  protected async start(): Promise<void> {
    this.errorKey.set(null);
    this.doneNote.set(false);
    void this.refreshPhones();
    try {
      await this.svc.create(handoffTargetPath(this.router.url));
    } catch (err) {
      this.errorKey.set(await this.svc.errorKey('create', err));
    }
  }

  protected async revoke(id: string | null): Promise<void> {
    try {
      await this.svc.revoke(id ?? undefined);
      this.doneNote.set(true);
      this.errorKey.set(null);
      await this.refreshPhones();
    } catch (err) {
      this.errorKey.set(await this.svc.errorKey('revoke', err));
    }
  }

  private async refreshPhones(): Promise<void> {
    try {
      this.phones.set(await this.svc.listConnected());
    } catch {
      this.phones.set([]);
    }
  }

  ngOnDestroy(): void {
    this.svc.stopWatching();
  }

  @HostListener('document:pointerdown', ['$event'])
  onOutside(ev: Event): void {
    if (!this.open()) return;
    const wrap = (this.host.nativeElement as HTMLElement).querySelector('.wrap');
    if (wrap && !wrap.contains(ev.target as Node)) this.close();
  }
}
