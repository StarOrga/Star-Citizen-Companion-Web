import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { type NameItem, type StepLike, fallbackEinsatzName, fallbackNachschubName } from './nachschub-fallback-names';
import { EINSATZ_NAME_MAX, NACHSCHUB_NAME_MAX, clampName } from './nachschub.model';

/**
 * Names for a Nachschub and its Einsaetze: the `nachschub-names` Edge Function (key stays server-side) with the
 * rule-based fallback on any failure. The result is a plain editable name, never marked as AI.
 */
@Injectable({ providedIn: 'root' })
export class NachschubNamingService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly i18n = inject(TranslateService);

  /**
   * A name from what the Nachschub holds. With nothing to name it by, the event it serves names it, else the day it
   * was made: never the generic "Neuer Nachschub", which reads like the action, not like this one Nachschub.
   */
  async nachschubName(items: readonly NameItem[], eventName?: string | null): Promise<string> {
    const event = eventName?.trim();
    if (!items.some((i) => i.name.trim())) return clampName(event || this.dayName(), NACHSCHUB_NAME_MAX);
    const fallback = fallbackNachschubName(items, event || this.dayName());
    return (await this.ask('nachschub', items, NACHSCHUB_NAME_MAX)) ?? fallback;
  }

  async einsatzName(steps: readonly StepLike[]): Promise<string> {
    const phrase = (kind: string, label: string): string => this.i18n.instant(`hq.nachschub.act.${kind}`, { label });
    const fallback = fallbackEinsatzName(steps, phrase, this.i18n.instant('hq.nachschub.newEinsatz'));
    const items = steps.map((s) => ({ name: phrase(s.kind, s.label).trim(), qty: 1 }));
    return (await this.ask('einsatz', items, EINSATZ_NAME_MAX)) ?? fallback;
  }

  private dayName(): string {
    const lang = this.i18n.getCurrentLang() === 'en' ? 'en' : 'de';
    const date = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' }).format(new Date());
    return this.i18n.instant('hq.nachschub.dayName', { date });
  }

  private async ask(kind: 'nachschub' | 'einsatz', items: readonly NameItem[], max: number): Promise<string | null> {
    if (!items.length) return null;
    try {
      const locale = this.i18n.getCurrentLang() === 'en' ? 'en' : 'de';
      const { data, error } = await this.sb.client.functions.invoke('nachschub-names', { body: { kind, locale, items } });
      if (error) throw error;
      const name = (data as { status?: string; name?: unknown } | null)?.name;
      return typeof name === 'string' && name.trim() ? clampName(name, max) : null;
    } catch (err) {
      logWarn('nachschub', 'name suggestion failed', err);
      return null;
    }
  }
}
