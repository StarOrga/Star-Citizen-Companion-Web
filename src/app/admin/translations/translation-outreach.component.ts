import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { ScDatePipe } from '../../core/locale/sc-date.pipe';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScSelectComponent, ScSelectOption } from '../../shared/sc-select.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { OutreachDraft, TranslationSource, TranslationsService } from './translations.service';
import { isRightsError } from './translations.logic';
import { TRANSLATIONS_TAB_STYLES } from './translations-shared.styles';

interface Edit {
  subject: string;
  body: string;
  message_lang: string;
}

/**
 * Anfragen tab: maintainer messages (notify / permission request) as drafts.
 * Nothing here sends anything: a protected admin approves, the text is copied
 * and sent by hand, then marked as sent; the answer is recorded afterwards.
 */
@Component({
  selector: 'sc-translation-outreach',
  standalone: true,
  imports: [TranslatePipe, ScDatePipe, ScActionDirective, ScSelectComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sc-card block">
      <h2>{{ 'admin.translations.outreach.title' | translate }}</h2>
      <p class="notice" data-test="no-auto-send">{{ 'admin.translations.outreach.noAutoSend' | translate }}</p>
      <p class="hint">{{ 'admin.translations.outreach.intro' | translate }}</p>
    </section>

    @if (flash(); as f) {
      <p class="flash" [class.err]="f.err" role="status">{{ f.key | translate }}</p>
    }

    @if (error()) {
      <div class="sc-card state error" role="alert">
        <p>{{ error()! | translate }}</p>
        <button scAction type="button" (click)="load()">{{ 'admin.translations.retry' | translate }}</button>
      </div>
    } @else if (loading()) {
      <div class="sc-card state" role="status">{{ 'admin.translations.loading' | translate }}</div>
    } @else if (items().length === 0) {
      <div class="sc-card state"><p class="hint">{{ 'admin.translations.outreach.empty' | translate }}</p></div>
    } @else {
      @for (o of items(); track o.id) {
        <section class="sc-card block" data-test="draft">
          <div class="row">
            <h3>{{ sourceName(o.source_id) }}</h3>
            <span class="pill">{{ 'admin.translations.outreach.kinds.' + o.kind | translate }}</span>
            <span class="pill" [class.ok]="o.status === 'approved' || o.status === 'answered'">
              {{ 'admin.translations.outreach.status.' + o.status | translate }}
            </span>
            @if (o.decision) {
              <span class="pill" [class.ok]="o.decision === 'granted'" [class.bad]="o.decision === 'refused'">
                {{ 'admin.translations.outreach.decisions.' + o.decision | translate }}
              </span>
            }
            <span class="grow"></span>
            <span class="hint">{{ o.created_at | scDate: 'datetime' }}</span>
          </div>

          @if (o.status === 'draft') {
            <div class="row">
              <label class="field grow">
                <span>{{ 'admin.translations.outreach.subject' | translate }}</span>
                <input class="sc-input" [value]="edit(o).subject" (input)="patch(o, { subject: $any($event.target).value })" />
              </label>
              <div class="field">
                <span>{{ 'admin.translations.outreach.messageLang' | translate }}</span>
                <sc-select [options]="langOptions" [value]="edit(o).message_lang" [allowEmpty]="false"
                           [ariaLabel]="'admin.translations.outreach.messageLang' | translate"
                           (valueChange)="patch(o, { message_lang: $event ?? 'de' })" />
              </div>
            </div>
            <label class="field">
              <span>{{ 'admin.translations.outreach.body' | translate }}</span>
              <textarea class="sc-input body" [value]="edit(o).body" (input)="patch(o, { body: $any($event.target).value })"></textarea>
            </label>
          } @else {
            <p class="subject">{{ o.subject }}</p>
            <pre class="body-text">{{ o.body }}</pre>
          }

          @if (o.answer) {
            <p class="hint">{{ 'admin.translations.outreach.answerRecorded' | translate }} {{ o.answer }}</p>
          }

          <div class="row">
            @if (o.status === 'draft') {
              <button scAction type="button" [disabled]="busy() || !dirty(o)" (click)="save(o)">
                {{ 'admin.translations.outreach.save' | translate }}
              </button>
              <span class="tip-wrap" [scTooltip]="'admin.translations.outreach.approveLocked' | translate"
                    scTooltipTier="label" [scTooltipDisabled]="!approveLocked()">
                <button scAction tier="primary" type="button" [disabled]="busy() || approveLocked() || dirty(o)" (click)="approve(o)">
                  {{ 'admin.translations.outreach.approve' | translate }}
                </button>
              </span>
            }
            <button scAction type="button" (click)="copy(o)">{{ 'admin.translations.outreach.copy' | translate }}</button>
            @if (o.status === 'approved') {
              <button scAction type="button" [disabled]="busy()" (click)="markSent(o)">
                {{ 'admin.translations.outreach.markSent' | translate }}
              </button>
            }
            @if (o.status === 'sent') {
              <button scAction type="button" [disabled]="busy()" (click)="openAnswer(o)">
                {{ 'admin.translations.outreach.recordAnswer' | translate }}
              </button>
            }
          </div>

          @if (answerFor() === o.id) {
            <form class="answer" (submit)="$event.preventDefault(); recordAnswer(o)">
              <label class="field grow">
                <span>{{ 'admin.translations.outreach.answerText' | translate }}</span>
                <textarea class="sc-input" [value]="answerText()" (input)="answerText.set($any($event.target).value)"></textarea>
              </label>
              <div class="field">
                <span>{{ 'admin.translations.outreach.decision' | translate }}</span>
                <sc-select [options]="decisionOptions" [value]="decision()" [allowEmpty]="false"
                           [ariaLabel]="'admin.translations.outreach.decision' | translate"
                           (valueChange)="decision.set($event === 'refused' ? 'refused' : 'granted')" />
              </div>
              <div class="row">
                <button scAction tier="primary" type="submit" [disabled]="busy() || !answerText().trim()">
                  {{ 'admin.translations.outreach.saveAnswer' | translate }}
                </button>
                <button scAction type="button" (click)="answerFor.set(null)">{{ 'admin.translations.outreach.cancel' | translate }}</button>
              </div>
            </form>
          }
        </section>
      }
    }
  `,
  styles: [
    TRANSLATIONS_TAB_STYLES,
    `
      .notice { margin: 0; padding: var(--sc-space-3) var(--sc-space-4); border-radius: var(--sc-radius-md, 10px);
        border: 1px solid var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .subject { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
      .body-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; color: var(--sc-fg-1); }
      textarea.body { min-height: 14rem; }
      .answer { display: grid; gap: var(--sc-space-3); padding-top: var(--sc-space-3); border-top: 1px solid var(--sc-border); }
    `,
  ],
})
export class TranslationOutreachComponent implements OnInit {
  private readonly svc = inject(TranslationsService);
  private readonly confirmSvc = inject(ScConfirmService);
  private readonly auth = inject(AuthService);

  readonly langOptions: ScSelectOption[] = ['de', 'en'].map((l) => ({
    value: l,
    labelKey: 'admin.translations.outreach.langs.' + l,
  }));
  readonly decisionOptions: ScSelectOption[] = ['granted', 'refused'].map((d) => ({
    value: d,
    labelKey: 'admin.translations.outreach.decisions.' + d,
  }));

  readonly items = signal<OutreachDraft[]>([]);
  readonly sources = signal<TranslationSource[]>([]);
  readonly edits = signal<Record<string, Edit>>({});
  /** null = unknown (directory unreadable): the button stays enabled and the DB decides (42501). */
  readonly isProtected = signal<boolean | null>(null);
  readonly approveLocked = computed(() => this.isProtected() === false);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly flash = signal<{ key: string; err: boolean } | null>(null);

  readonly answerFor = signal<string | null>(null);
  readonly answerText = signal('');
  readonly decision = signal<'granted' | 'refused'>('granted');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [items, sources] = await Promise.all([this.svc.listOutreach(), this.svc.listSources()]);
      this.items.set(items);
      this.sources.set(sources);
      this.edits.set({});
    } catch (e) {
      this.error.set(toErrorKey('admin-translations', 'outreach-load', e));
    } finally {
      this.loading.set(false);
    }
    void this.loadProtected();
  }

  private async loadProtected(): Promise<void> {
    try {
      const me = this.auth.realUser()?.id;
      const people = await this.svc.people();
      this.isProtected.set(me && people.has(me) ? people.get(me)!.isProtected : null);
    } catch (e) {
      logWarn('admin-translations', 'protected status unknown', e);
      this.isProtected.set(null);
    }
  }

  sourceName(id: string): string {
    return this.sources().find((s) => s.id === id)?.name ?? id;
  }

  edit(o: OutreachDraft): Edit {
    return this.edits()[o.id] ?? { subject: o.subject, body: o.body, message_lang: o.message_lang };
  }

  patch(o: OutreachDraft, p: Partial<Edit>): void {
    this.edits.update((m) => ({ ...m, [o.id]: { ...this.edit(o), ...p } }));
  }

  dirty(o: OutreachDraft): boolean {
    const e = this.edits()[o.id];
    return !!e && (e.subject !== o.subject || e.body !== o.body || e.message_lang !== o.message_lang);
  }

  private replace(row: OutreachDraft): void {
    this.items.update((l) => l.map((x) => (x.id === row.id ? { ...x, ...row } : x)));
    this.edits.update((m) => {
      const rest = { ...m };
      delete rest[row.id];
      return rest;
    });
  }

  private async run(op: string, fn: () => Promise<unknown>, rightsKey?: string): Promise<boolean> {
    this.busy.set(true);
    this.flash.set(null);
    try {
      await fn();
      this.flash.set({ key: 'admin.translations.saved', err: false });
      return true;
    } catch (e) {
      const key = rightsKey && isRightsError(e) ? rightsKey : toErrorKey('admin-translations', op, e);
      this.flash.set({ key, err: true });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  async save(o: OutreachDraft): Promise<void> {
    const e = this.edit(o);
    if (await this.run('outreach-save', () => this.svc.saveOutreachDraft(o.id, e))) {
      this.replace({ ...o, ...e });
    }
  }

  async approve(o: OutreachDraft): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.outreach.approveTitle',
      messageKey: 'admin.translations.outreach.approveText',
      params: { name: this.sourceName(o.source_id) },
      confirmKey: 'admin.translations.outreach.approve',
    });
    if (!ok) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      this.replace(await this.svc.approveOutreach(o.id));
      this.flash.set({ key: 'admin.translations.outreach.approved', err: false });
    } catch (e) {
      if (isRightsError(e)) this.isProtected.set(false);
      this.flash.set({
        key: isRightsError(e) ? 'admin.translations.outreach.approveLocked' : toErrorKey('admin-translations', 'outreach-approve', e),
        err: true,
      });
    } finally {
      this.busy.set(false);
    }
  }

  async copy(o: OutreachDraft): Promise<void> {
    const e = this.edit(o);
    try {
      await navigator.clipboard.writeText(`${e.subject}\n\n${e.body}`);
      this.flash.set({ key: 'admin.translations.outreach.copied', err: false });
    } catch (err) {
      this.flash.set({ key: toErrorKey('admin-translations', 'outreach-copy', err), err: true });
    }
  }

  async markSent(o: OutreachDraft): Promise<void> {
    const ok = await this.confirmSvc.confirm({
      titleKey: 'admin.translations.outreach.markSentTitle',
      messageKey: 'admin.translations.outreach.markSentText',
      params: { name: this.sourceName(o.source_id) },
      confirmKey: 'admin.translations.outreach.markSent',
    });
    if (!ok) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      this.replace(await this.svc.markOutreachSent(o.id));
      this.flash.set({ key: 'admin.translations.saved', err: false });
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'outreach-sent', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }

  openAnswer(o: OutreachDraft): void {
    this.answerFor.set(o.id);
    this.answerText.set('');
    this.decision.set('granted');
  }

  async recordAnswer(o: OutreachDraft): Promise<void> {
    const text = this.answerText().trim();
    if (!text) return;
    this.busy.set(true);
    this.flash.set(null);
    try {
      this.replace(await this.svc.recordOutreachAnswer(o.id, text, this.decision()));
      this.answerFor.set(null);
      this.flash.set({ key: 'admin.translations.saved', err: false });
    } catch (e) {
      this.flash.set({ key: toErrorKey('admin-translations', 'outreach-answer', e), err: true });
    } finally {
      this.busy.set(false);
    }
  }
}
