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

  async nachschubName(items: readonly NameItem[]): Promise<string> {
    const fallback = fallbackNachschubName(items, this.i18n.instant('hq.nachschub.newName'));
    return (await this.ask('nachschub', items, NACHSCHUB_NAME_MAX)) ?? fallback;
  }

  async einsatzName(steps: readonly StepLike[]): Promise<string> {
    const verb = (k: string): string => this.i18n.instant(`hq.nachschub.verb.${k}`);
    const fallback = fallbackEinsatzName(steps, verb, this.i18n.instant('hq.nachschub.newEinsatz'));
    const items = steps.map((s) => ({ name: `${verb(s.kind)} ${s.label}`.trim(), qty: 1 }));
    return (await this.ask('einsatz', items, EINSATZ_NAME_MAX)) ?? fallback;
  }

  private async ask(kind: 'nachschub' | 'einsatz', items: readonly NameItem[], max: number): Promise<string | null> {
    if (!items.length) return null;
    try {
      const locale = this.i18n.currentLang === 'en' ? 'en' : 'de';
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
