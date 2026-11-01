import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { HqLiveService } from './hq-live.service';
import { dayKey, eventLabel } from './hq-live.util';

/** The full event log, grouped by day, older pages on demand ("Mehr laden", 30 per page). */
@Component({
  selector: 'sc-hq-log-dialog',
  standalone: true,
  imports: [TranslatePipe, DatePipe, ScDialogDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <section
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hq-log-title"
      scDialog
      (scDialogEscape)="closed.emit()"
    >
      <header>
        <h3 id="hq-log-title">{{ 'hq.log.title' | translate }}</h3>
        <button type="button" class="close" (click)="closed.emit()">{{ 'hq.log.close' | translate }}</button>
      </header>
      <div class="body">
        @if (live.error()) { <p class="err" role="alert">{{ live.error()! | translate }}</p> }
        @if (days().length === 0 && !live.error()) {
          <p class="empty">{{ 'hq.log.empty' | translate }}</p>
        }
        @for (day of days(); track day.key) {
          <h4 class="day">{{ day.at | date: 'fullDate' }}</h4>
          <ul>
            @for (ev of day.events; track ev.id) {
              <li [class.undone]="ev.undone">
                <time class="mono" [attr.datetime]="ev.at">{{ ev.at | date: 'shortTime' }}</time>
                <span class="text">{{ label(ev).key | translate: label(ev).params }}</span>
                @if (ev.undone) {
                  <span class="tag">{{ 'hq.log.undone' | translate }}</span>
                } @else if (live.undoable(ev)) {
                  <button type="button" class="undo" (click)="live.undo(ev.id)">{{ 'hq.log.undo' | translate }}</button>
                }
              </li>
            }
          </ul>
        }
        @if (live.hasMore() && days().length > 0) {
          <button type="button" class="more" [disabled]="busy()" (click)="more()">{{ 'hq.log.more' | translate }}</button>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; }
      .backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / 0.6); }
      .dialog {
        position: relative; width: min(560px, calc(100vw - 2 * var(--sc-space-3, 12px))); max-height: 85vh; max-height: 85dvh;
        display: flex; flex-direction: column; background: var(--sc-surface, #111); border: 1px solid var(--sc-border);
        border-radius: var(--sc-radius, 10px);
      }
      header { display: flex; align-items: center; justify-content: space-between; padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border-bottom: 1px solid var(--sc-border); }
      h3 { margin: 0; font-size: 1.1rem; }
      .body { overflow-y: auto; padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); }
      .day { margin: var(--sc-space-3, 12px) 0 var(--sc-space-1, 4px); font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-fg-2); }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) 0; border-bottom: 1px solid var(--sc-border); }
      li.undone .text { text-decoration: line-through; color: var(--sc-fg-2); }
      time { flex: none; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .tag { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      button { min-height: 44px; padding: 0 var(--sc-space-3, 12px); border-radius: var(--sc-radius, 10px); border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg); cursor: pointer; }
      button:hover:not(:disabled) { border-color: var(--sc-accent); color: var(--sc-accent); }
      button:disabled { opacity: 0.5; cursor: default; }
      .more { display: block; margin: var(--sc-space-3, 12px) auto 0; }
      .empty { color: var(--sc-fg-2); }
      .err { color: var(--sc-danger); }
    `,
  ],
})
export class HqLogDialogComponent {
  readonly live = inject(HqLiveService);
  readonly closed = output<void>();
  readonly busy = signal(false);

  readonly days = computed(() => {
    const out: { key: string; at: string; events: ReturnType<HqLiveService['events']> extends readonly (infer E)[] ? E[] : never }[] = [];
    for (const ev of this.live.events()) {
      const key = dayKey(ev.at);
      const last = out.at(-1);
      if (last?.key === key) last.events.push(ev);
      else out.push({ key, at: ev.at, events: [ev] });
    }
    return out;
  });

  readonly label = eventLabel;

  async more(): Promise<void> {
    this.busy.set(true);
    try {
      await this.live.loadMore();
    } finally {
      this.busy.set(false);
    }
  }
}
