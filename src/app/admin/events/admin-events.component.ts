import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import {
  EVENT_SHEET_FIELD_KEYS,
  approveField,
  normalizeSheet,
  setByAdmin,
  type EventSheet,
  type EventSheetFieldKey,
  type FieldReview,
  type SheetField,
} from '../../hq/events/event-sheet';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

interface AdminEventRow {
  readonly id: string;
  readonly name: string;
  readonly start: string;
  readonly end: string;
  readonly sheet: EventSheet | null;
  readonly draft: EventSheet | null;
}
export interface HistoryRow {
  readonly id: number;
  readonly actorKind: 'ai' | 'admin';
  readonly at: string;
  readonly note: string | null;
}

/** One-line reading of a field value for the review table (full value stays in the by-hand editor). */
export function fieldSummary(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Needs a decision: a value waits for review. */
export const needsReview = (f: SheetField<unknown>): boolean => f.value !== null && f.review === 'pending';

/** The sheet with one field marked rejected (the public sheet blanks it). */
export function rejectField(sheet: EventSheet, key: EventSheetFieldKey): EventSheet {
  const f = sheet.fields[key];
  return { ...sheet, fields: { ...sheet.fields, [key]: { ...f, review: 'rejected' as FieldReview } } as unknown as EventSheet['fields'] };
}

/**
 * Admin review page for event data sheets (F11, ev-a10): events, every field with value / confidence / source / review,
 * approve or set by hand, history of every extraction run and edit, and „Neu auswerten“ (re-extract one event).
 * Admin-only: the route has `roleGuard('admin')`; the surface says so in words and wears the hot accent.
 */
@Component({
  selector: 'sc-admin-events',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header [eyebrow]="'adminEvents.eyebrow' | translate" [title]="'adminEvents.title' | translate" [subtitle]="'adminEvents.subtitle' | translate" />
    @if (error(); as e) {
      <p class="err" role="alert">{{ e | translate }} <button type="button" scAction tier="secondary" (click)="load()">{{ 'adminEvents.retry' | translate }}</button></p>
    }
    <div class="wrap">
      <ul class="list" [attr.aria-label]="'adminEvents.listAria' | translate">
        @for (r of rows(); track r.id) {
          <li>
            <button type="button" class="row" [attr.aria-pressed]="r.id === selectedId()" (click)="select(r.id)">
              <b>{{ r.name }}</b>
              <small>{{ r.start }} – {{ r.end }}</small>
              @if (pendingCount(r) > 0) { <span class="badge">{{ 'adminEvents.pending' | translate: { n: pendingCount(r) } }}</span> }
              @if (!r.draft && !r.sheet) { <span class="badge mute">{{ 'adminEvents.noSheet' | translate }}</span> }
            </button>
          </li>
        } @empty {
          <li class="mute">{{ (loading() ? 'adminEvents.loading' : 'adminEvents.empty') | translate }}</li>
        }
      </ul>

      @if (current(); as ev) {
        <section class="detail" [attr.aria-label]="ev.name">
          <header class="dh">
            <h2>{{ ev.name }}</h2>
            <button type="button" scAction tier="secondary" [busy]="reextracting()" (click)="reextract(ev.id)">{{ 'adminEvents.reextract' | translate }}</button>
          </header>
          @if (actionError(); as ae) { <p class="err" role="alert">{{ ae | translate }}</p> }
          <div class="sc-table-scroll">
            <table class="fields">
              <thead>
                <tr>
                  <th scope="col">{{ 'adminEvents.col.field' | translate }}</th>
                  <th scope="col">{{ 'adminEvents.col.value' | translate }}</th>
                  <th scope="col">{{ 'adminEvents.col.confidence' | translate }}</th>
                  <th scope="col">{{ 'adminEvents.col.source' | translate }}</th>
                  <th scope="col">{{ 'adminEvents.col.review' | translate }}</th>
                  <th scope="col"><span class="vh">{{ 'adminEvents.col.actions' | translate }}</span></th>
                </tr>
              </thead>
              <tbody>
                @for (k of keys; track k) {
                  @let f = sheetOf(ev).fields[k];
                  <tr [class.wait]="f.review === 'pending'">
                    <th scope="row">{{ 'adminEvents.field.' + k | translate }}</th>
                    <td class="val">
                      @if (editing() === k) {
                        <textarea class="input" rows="4" [value]="draftText()" (input)="draftText.set($any($event.target).value)" [attr.aria-label]="'adminEvents.editAria' | translate"></textarea>
                      } @else if (f.value === null) {
                        <span class="mute">{{ 'adminEvents.unknown' | translate }}</span>
                      } @else {
                        <code>{{ summary(f.value) }}</code>
                      }
                    </td>
                    <td class="num">{{ (f.confidence * 100).toFixed(0) }} %</td>
                    <td>{{ f.source }}</td>
                    <td><span class="rev" [attr.data-review]="f.review">{{ 'adminEvents.review.' + f.review | translate }}</span></td>
                    <td class="acts">
                      @if (editing() === k) {
                        <button type="button" scAction tier="secondary" [busy]="saving()" (click)="saveEdit(ev, k)">{{ 'adminEvents.save' | translate }}</button>
                        <button type="button" scAction tier="secondary" (click)="editing.set(null)">{{ 'common.dialog.cancel' | translate }}</button>
                      } @else {
                        @if (f.value !== null && f.review !== 'approved' && f.review !== 'edited') {
                          <button type="button" scAction tier="secondary" [disabled]="saving()" (click)="approve(ev, k)">{{ 'adminEvents.approve' | translate }}</button>
                          <button type="button" scAction tier="secondary" tone="danger" [disabled]="saving()" (click)="reject(ev, k)">{{ 'adminEvents.reject' | translate }}</button>
                        }
                        <button type="button" scAction tier="secondary" [disabled]="saving()" (click)="startEdit(ev, k)">{{ 'adminEvents.edit' | translate }}</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <h3>{{ 'adminEvents.history' | translate }}</h3>
          <ul class="hist">
            @for (h of history(); track h.id) {
              <li><span class="kind" [class.ai]="h.actorKind === 'ai'">{{ 'adminEvents.actor.' + h.actorKind | translate }}</span> {{ h.at }} @if (h.note) { · {{ h.note }} }</li>
            } @empty {
              <li class="mute">{{ 'adminEvents.historyEmpty' | translate }}</li>
            }
          </ul>
        </section>
      } @else {
        <p class="mute pick">{{ 'adminEvents.pick' | translate }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .wrap { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; gap: var(--sc-space-4, 16px); min-height: 0; }
      @media (max-width: 860px) { .wrap { grid-template-columns: 1fr; } }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: calc(100dvh - 18rem); overflow: auto; }
      .row { width: 100%; text-align: start; display: flex; flex-direction: column; gap: 2px; padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-1); color: var(--sc-fg); font: inherit; cursor: pointer; }
      .row[aria-pressed='true'] { border-color: var(--sc-accent-hot); background: color-mix(in srgb, var(--sc-accent-hot) 10%, var(--sc-bg-1)); }
      .row:focus-visible { outline: 2px solid var(--sc-accent-hot); outline-offset: 2px; }
      .badge { align-self: flex-start; padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-warning) 20%, transparent); color: var(--sc-warning); font-size: 0.74rem; }
      .badge.mute, .mute { color: var(--sc-fg-2); background: none; }
      .dh { display: flex; align-items: center; gap: var(--sc-space-3, 12px); }
      .dh h2 { margin: 0; flex: 1; font: 600 1.2rem var(--sc-font-display, inherit); }
      .fields { width: 100%; border-collapse: collapse; }
      .fields th, .fields td { padding: 6px 8px; border-bottom: 1px solid var(--sc-border); text-align: start; vertical-align: top; }
      .fields thead th { color: var(--sc-fg-2); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; }
      tr.wait { background: color-mix(in srgb, var(--sc-warning) 8%, transparent); }
      .val { max-width: 34ch; overflow-wrap: anywhere; }
      .val code { font-size: 0.8rem; }
      .val textarea { width: 100%; font-family: var(--sc-font-mono, monospace); }
      .acts { white-space: nowrap; display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 0; }
      .num { font-variant-numeric: tabular-nums; }
      .rev[data-review='pending'] { color: var(--sc-warning); }
      .rev[data-review='approved'], .rev[data-review='edited'] { color: var(--sc-success); }
      .rev[data-review='rejected'] { color: var(--sc-danger); }
      .hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 0.88rem; }
      .kind { padding: 1px 8px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: 0.74rem; }
      .kind.ai { border-color: var(--sc-accent-hot); color: var(--sc-accent-hot); }
      h3 { margin: var(--sc-space-3, 12px) 0 4px; font-size: 1rem; }
      .err { color: var(--sc-warning); margin: 0; display: flex; gap: var(--sc-space-3, 12px); align-items: center; }
      .vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    `,
  ],
})
export class AdminEventsComponent {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  protected readonly keys = EVENT_SHEET_FIELD_KEYS;
  protected readonly rows = signal<readonly AdminEventRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly history = signal<readonly HistoryRow[]>([]);
  protected readonly editing = signal<EventSheetFieldKey | null>(null);
  protected readonly draftText = signal('');
  protected readonly saving = signal(false);
  protected readonly reextracting = signal(false);
  protected readonly summary = fieldSummary;

  protected readonly current = computed(() => this.rows().find((r) => r.id === this.selectedId()) ?? null);

  constructor() {
    void this.load();
  }

  protected sheetOf = (r: AdminEventRow): EventSheet => r.draft ?? r.sheet ?? normalizeSheet(null);
  protected pendingCount = (r: AdminEventRow): number => EVENT_SHEET_FIELD_KEYS.filter((k) => needsReview(this.sheetOf(r).fields[k])).length;

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
      const [ev, dr] = await Promise.all([
        this.sb.client.from('sc_events' as never).select('id,name,start_date,end_date,sheet').gte('end_date', since).order('start_date', { ascending: false }).limit(200),
        this.sb.client.from('sc_event_sheet_drafts' as never).select('event_id,sheet'),
      ]);
      if (ev.error) throw ev.error;
      if (dr.error) throw dr.error;
      const drafts = new Map(((dr.data ?? []) as unknown as { event_id: string; sheet: unknown }[]).map((d) => [d.event_id, normalizeSheet(d.sheet)] as const));
      this.rows.set(
        ((ev.data ?? []) as unknown as { id: string; name: string; start_date: string; end_date: string; sheet: unknown }[]).map((e) => ({
          id: e.id,
          name: e.name,
          start: e.start_date,
          end: e.end_date,
          sheet: e.sheet ? normalizeSheet(e.sheet) : null,
          draft: drafts.get(e.id) ?? null,
        })),
      );
    } catch (err) {
      this.error.set(toErrorKey('admin', 'events.load', err));
    } finally {
      this.loading.set(false);
    }
  }

  protected select(id: string): void {
    this.selectedId.set(id);
    this.editing.set(null);
    this.actionError.set(null);
    void this.loadHistory(id);
  }

  private async loadHistory(id: string): Promise<void> {
    try {
      const { data, error } = await this.sb.client
        .from('sc_event_sheet_history' as never)
        .select('id,actor_kind,created_at,note')
        .eq('event_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      this.history.set(
        ((data ?? []) as unknown as { id: number; actor_kind: 'ai' | 'admin'; created_at: string; note: string | null }[]).map((h) => ({ id: h.id, actorKind: h.actor_kind, at: h.created_at.slice(0, 16).replace('T', ' '), note: h.note })),
      );
    } catch (err) {
      this.actionError.set(toErrorKey('admin', 'events.history', err));
    }
  }

  protected approve(r: AdminEventRow, k: EventSheetFieldKey): Promise<void> {
    return this.apply(r, approveField(this.sheetOf(r), k));
  }
  protected reject(r: AdminEventRow, k: EventSheetFieldKey): Promise<void> {
    return this.apply(r, rejectField(this.sheetOf(r), k));
  }
  protected startEdit(r: AdminEventRow, k: EventSheetFieldKey): void {
    const v = this.sheetOf(r).fields[k].value;
    this.draftText.set(v === null ? '' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v, null, 2));
    this.editing.set(k);
  }
  protected async saveEdit(r: AdminEventRow, k: EventSheetFieldKey): Promise<void> {
    let raw: unknown = null;
    const text = this.draftText().trim();
    if (text) {
      try {
        raw = JSON.parse(text);
      } catch {
        this.actionError.set('adminEvents.badJson');
        return;
      }
    }
    await this.apply(r, setByAdmin(this.sheetOf(r), k, raw));
    if (!this.actionError()) this.editing.set(null);
  }

  /** Every write goes through sc_event_sheet_apply: draft + public sheet + one history row. */
  private async apply(r: AdminEventRow, sheet: EventSheet): Promise<void> {
    this.saving.set(true);
    this.actionError.set(null);
    try {
      const { error } = await this.sb.client.rpc('sc_event_sheet_apply' as never, {
        p_event_id: r.id,
        p_sheet: sheet,
        p_actor_kind: 'admin',
        p_actor_id: this.auth.user()?.id ?? null,
      } as never);
      if (error) throw error;
      await this.load();
      await this.loadHistory(r.id);
    } catch (err) {
      this.actionError.set(toErrorKey('admin', 'events.save', err));
    } finally {
      this.saving.set(false);
    }
  }

  /** "Neu auswerten": the edge function re-extracts this one event (admin JWT, force). */
  protected async reextract(id: string): Promise<void> {
    this.reextracting.set(true);
    this.actionError.set(null);
    try {
      const { error } = await this.sb.client.functions.invoke('sc-event-sheet', { body: { eventId: id, force: true } });
      if (error) throw error;
      await this.load();
      await this.loadHistory(id);
    } catch (err) {
      this.actionError.set(toErrorKey('admin', 'events.reextract', err));
    } finally {
      this.reextracting.set(false);
    }
  }
}
