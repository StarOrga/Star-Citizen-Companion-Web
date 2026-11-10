import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { logWarn } from '../core/log';
import { LOCALE_SHARD_FETCH } from './codex-locale-shards';
import type { Lang } from './codex.types';

/**
 * Translated room labels (E14, holotisch concept 20261109-1745).
 *
 * The uploader registers every room label the game ships without German as an
 * English string `scc_room_<slug>` (`ShipDeckRoom.labelKey`); the translation
 * pipeline translates it like any new game string and publishes the
 * `scc_room_*` slice of its overlay as `translation-overlay/<lang>/rooms.json`
 * (docs/translation/ARCHITECTURE.md § Room labels). It is read through the
 * signed-in `translation-overlay` function (`?ns=rooms`), so a signed-out
 * reader, English, or a language with nothing published gets an empty map and
 * the deck plan keeps its English label.
 */
const EMPTY: ReadonlyMap<string, string> = new Map();

@Injectable({ providedIn: 'root' })
export class RoomLabelTranslations {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly fetchFn = inject(LOCALE_SHARD_FETCH);
  private readonly byLang = signal<Readonly<Partial<Record<Lang, ReadonlyMap<string, string>>>>>({});
  private readonly pending = new Set<Lang>();

  /**
   * `labelKey → translated label` for `lang`. Reactive: empty until loaded,
   * then the map. Reading it starts the load once per language (the signal is
   * only written after an await, so this is safe inside a `computed`).
   */
  labels(lang: Lang): ReadonlyMap<string, string> {
    const have = this.byLang()[lang];
    if (have) return have;
    if (lang !== 'en' && !this.pending.has(lang)) {
      this.pending.add(lang);
      void this.load(lang);
    }
    return EMPTY;
  }

  private async load(lang: Lang): Promise<void> {
    try {
      const { data } = await this.sb.client.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        // Signed out: try again on the next read (after a sign-in).
        this.pending.delete(lang);
        return;
      }
      const base = (this.sb.client as unknown as { supabaseUrl: string }).supabaseUrl;
      const res = await this.fetchFn(`${base}/functions/v1/translation-overlay?lang=${lang}&ns=rooms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 404 = nothing published for this language yet: English labels, no retry.
      const map = res.ok ? toLabelMap(await res.json()) : EMPTY;
      if (!res.ok && res.status !== 404) logWarn('codex.rooms', 'room label overlay failed', { status: res.status });
      this.byLang.update((m) => ({ ...m, [lang]: map }));
    } catch (e) {
      // Translation never blocks the plan; the English label stays.
      logWarn('codex.rooms', 'room label overlay failed', e);
      this.byLang.update((m) => ({ ...m, [lang]: EMPTY }));
    }
  }
}

/** `{ entries: { key: { h, t } } }` → key → text, `scc_room_*` keys only. */
export function toLabelMap(body: unknown): ReadonlyMap<string, string> {
  const entries = (body as { entries?: unknown } | null)?.entries;
  if (!entries || typeof entries !== 'object') return EMPTY;
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
    const t = (v as { t?: unknown } | null)?.t;
    if (k.startsWith('scc_room_') && typeof t === 'string' && t.trim()) out.set(k, t.trim());
  }
  return out;
}
