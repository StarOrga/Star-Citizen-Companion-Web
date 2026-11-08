import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { readMigrated, removeWithLegacy } from '../../core/storage-keys';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqInventoryService } from '../data/hq-inventory.service';
import { BLUEPRINT_PLACE, NEWS_FAVORITES_STORAGE_KEY, SammlungEntry, bookmarksToCopy } from './sammlung.model';

/**
 * The Sammlung (collected things) as the HQ reads it: Blaupausen (stock rows at the blueprint place), Ruf (empty,
 * no data source yet - the SCC-App may deliver it later), news the user collected (`user_news_collected`) and
 * up-voted gallery wallpapers (`wallpaper_votes`; the gallery itself does not change, an up-vote simply counts).
 *
 * News bookmarks used to live in localStorage; {@link copyLocalNewsBookmarks} copies them into the account on the next
 * visit and clears the local key only after the copy is confirmed.
 */
@Injectable({ providedIn: 'root' })
export class SammlungService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly inventory = inject(HqInventoryService);

  readonly news = signal<ReadonlySet<string>>(new Set());
  readonly gallery = signal<ReadonlySet<string>>(new Set());
  readonly loaded = signal(false);
  /** i18n key of the last failed load / write, never raw text. */
  readonly error = signal<string | null>(null);

  /** Collected blueprints (class names) - the stock rows at the blueprint place. */
  readonly blueprints = computed<readonly SammlungEntry[]>(() =>
    this.inventory
      .items()
      .filter((i) => i.location === BLUEPRINT_PLACE)
      .map((i) => ({ kind: 'blueprint' as const, id: i.class_name ?? i.name, name: i.name })),
  );

  /** Ruf has no data source yet: an empty list, never invented numbers. */
  readonly rep = signal<readonly SammlungEntry[]>([]);
  readonly repSource = 'none' as const;

  private loadedFor: string | null = null;

  async load(): Promise<void> {
    const uid = this.auth.user()?.id ?? null;
    if (!uid) {
      this.news.set(new Set());
      this.gallery.set(new Set());
      this.loadedFor = null;
      this.loaded.set(false);
      return;
    }
    if (this.loadedFor === uid) return;
    this.loadedFor = uid;
    try {
      const c = this.sb.client;
      const [n, g] = await Promise.all([
        c.from('user_news_collected' as never).select('news_id'),
        c.from('wallpaper_votes' as never).select('image_id'),
      ]);
      if (n.error) throw n.error;
      if (g.error) throw g.error;
      if (this.loadedFor !== uid) return;
      this.news.set(new Set(((n.data ?? []) as unknown as { news_id: string }[]).map((r) => r.news_id)));
      this.gallery.set(new Set(((g.data ?? []) as unknown as { image_id: string }[]).map((r) => r.image_id)));
      this.loaded.set(true);
      this.error.set(null);
      await this.copyLocalNewsBookmarks();
    } catch (err) {
      if (this.loadedFor === uid) this.loadedFor = null;
      this.error.set(toErrorKey('sammlung', 'load', err));
    }
  }

  async collectNews(id: string): Promise<boolean> {
    if (!this.auth.user()) return false;
    if (this.news().has(id)) return true;
    // Optimistic: the set shows it at once, a failed write takes it back.
    this.news.update((s) => new Set([...s, id]));
    try {
      const { error } = await this.sb.client.from('user_news_collected' as never).insert({ news_id: id } as never);
      if (error && (error as { code?: string }).code !== '23505') throw error;
      return true;
    } catch (err) {
      this.news.update((s) => new Set([...s].filter((x) => x !== id)));
      this.error.set(toErrorKey('sammlung', 'collectNews', err));
      return false;
    }
  }

  async uncollectNews(id: string): Promise<boolean> {
    if (!this.auth.user()) return false;
    this.news.update((s) => new Set([...s].filter((x) => x !== id)));
    try {
      const { error } = await this.sb.client.from('user_news_collected' as never).delete().eq('news_id', id);
      if (error) throw error;
      return true;
    } catch (err) {
      this.news.update((s) => new Set([...s, id]));
      this.error.set(toErrorKey('sammlung', 'uncollectNews', err));
      return false;
    }
  }

  /**
   * Copy the old localStorage bookmarks into the account (r2 d2-newsmove = copy). The local key is removed only when
   * the insert succeeded; a failure keeps it for the next visit. Returns how many ids were copied.
   */
  async copyLocalNewsBookmarks(): Promise<number> {
    if (!this.auth.user() || typeof localStorage === 'undefined') return 0;
    let raw: string | null = null;
    try {
      raw = readMigrated(NEWS_FAVORITES_STORAGE_KEY);
    } catch {
      return 0;
    }
    if (raw === null) return 0;
    const ids = bookmarksToCopy(raw, this.news());
    try {
      if (ids.length) {
        const { error } = await this.sb.client
          .from('user_news_collected' as never)
          .upsert(ids.map((news_id) => ({ news_id })) as never, { onConflict: 'user_id,news_id', ignoreDuplicates: true });
        if (error) throw error;
        this.news.update((s) => new Set([...s, ...ids]));
      }
      removeWithLegacy(NEWS_FAVORITES_STORAGE_KEY);
      return ids.length;
    } catch (err) {
      logWarn('sammlung', 'news bookmark copy failed', err);
      return 0;
    }
  }
}
