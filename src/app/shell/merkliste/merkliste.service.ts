import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqSuppliesService } from '../../hq/hq-supplies.service';
import { WishlistStore, type WishRow } from '../../hq/data/wishlist.store';
import { NewsService } from '../../news/news.service';
import { WishNamesService } from '../../codex/search/wish-names.service';
import { readRecentRows, type StoredRow } from '../fusion-bar/search-recent-rows';
import {
  MERK_NEWS_SHOWN,
  MERK_RECENT_SHOWN,
  MERK_WISH_SHOWN,
  merkTypeOf,
  recentRowsOfType,
  wishRowOfType,
  type MerkRow,
  type MerkType,
} from './merkliste.model';

export const NEWS_READ_KEY = 'sc.merkliste.newsRead';
const NEWS_READ_MAX = 12;

interface ReadEntry {
  id: string;
  title: string;
  channel: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readReads(): ReadEntry[] {
  try {
    const list = JSON.parse(storage()?.getItem(NEWS_READ_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((e): e is ReadEntry => !!e && typeof e.id === 'string' && typeof e.title === 'string').slice(0, NEWS_READ_MAX) : [];
  } catch {
    return [];
  }
}

/**
 * Everything the header bookmark shows (concept r2-merk = panel, gw-global = bar): the page's
 * type, the recently opened and the wished entries of that type, the news the reader read and
 * bookmarked, and the number on the icon (open Nachschub lines + wishes + bookmarked posts).
 * Local-only data (recent rows, read log) never leaves the device.
 */
@Injectable({ providedIn: 'root' })
export class MerklisteService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly wishStore = inject(WishlistStore);
  private readonly hangar = inject(HangarService);
  private readonly supplies = inject(HqSuppliesService);
  private readonly news = inject(NewsService);
  private readonly consent = inject(ConsentService);
  private readonly wishNames = inject(WishNamesService);

  private readonly url = signal(this.router.url);
  readonly type = computed<MerkType | null>(() => merkTypeOf(this.url()));

  private readonly recents = signal<StoredRow[]>(readRecentRows(storage()));
  private readonly reads = signal<ReadEntry[]>(readReads());

  constructor() {
    this.router.events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      this.url.set(e.urlAfterRedirects);
      this.noteNewsRead(e.urlAfterRedirects);
    });
    effect(() => {
      if (this.auth.user()) void this.wishStore.ensureLoaded();
    });
  }

  /** The panel opens: pick up what the search wrote since. */
  refresh(): void {
    this.recents.set(readRecentRows(storage()));
    this.reads.set(readReads());
    if (!this.news.feed() && this.news.favoriteIds().size > 0) void this.news.refresh(true);
  }

  private noteNewsRead(url: string): void {
    const m = /^\/verse\/news\/([^/?#]+)/.exec(url);
    if (!m) return;
    const id = decodeURIComponent(m[1]);
    const item = this.news.itemById(id);
    if (!item || !this.consent.preferencesAllowed()) return;
    const next = [{ id, title: item.title, channel: item.channel }, ...this.reads().filter((r) => r.id !== id)].slice(0, NEWS_READ_MAX);
    this.reads.set(next);
    try {
      storage()?.setItem(NEWS_READ_KEY, JSON.stringify(next));
    } catch {
      /* quota / private mode */
    }
  }

  /** Wishes: the single table plus the hangar's wished live ships. */
  private readonly wishes = computed<Pick<WishRow, 'kind' | 'className' | 'name' | 'manufacturer'>[]>(() => [
    ...this.wishStore.rows(),
    ...this.hangar
      .ships()
      .filter((s) => s.status === 'wishlist')
      .map((s) => ({ kind: 'ship', className: s.shipClassName, name: null, manufacturer: null })),
  ]);

  readonly wishCount = computed(() => this.wishes().length);
  readonly supplyOpen = computed(() => this.supplies.open().length);
  readonly bookmarkCount = computed(() => this.news.favoriteIds().size);
  /** The number on the icon; the icon is hidden at 0. */
  readonly count = computed(() => this.supplyOpen() + this.wishCount() + this.bookmarkCount());

  readonly recent = computed<MerkRow[]>(() => {
    const type = this.type();
    if (type === 'news') return [];
    return recentRowsOfType(this.recents(), type).slice(0, MERK_RECENT_SHOWN);
  });
  readonly wished = computed<MerkRow[]>(() => {
    const type = this.type();
    if (type === 'news') return [];
    const out: MerkRow[] = [];
    const wishes = this.wishes();
    // Entries stored without a name (older wishes, wished ships) resolve from the catalog; the
    // lookup answers into a signal, so the rows below re-render with the real names.
    this.wishNames.request(wishes.filter((w) => !w.name && w.kind !== 'upcoming').map((w) => w.className));
    for (const w of wishes) {
      const row = wishRowOfType(w, type, this.wishNames.nameOf);
      if (row) out.push(row);
    }
    return out;
  });
  readonly wishedShown = computed(() => this.wished().slice(0, MERK_WISH_SHOWN));

  readonly newsRead = computed<MerkRow[]>(() =>
    this.reads()
      .slice(0, MERK_RECENT_SHOWN)
      .map((r) => ({ id: `read:${r.id}`, type: 'news' as const, title: r.title, subtitle: null, subtitleKey: `news.channels.${r.channel}`, target: { link: ['/verse/news', r.id], queryParams: null }, href: null })),
  );
  readonly newsSaved = computed<MerkRow[]>(() => {
    const feed = this.news.feed()?.news ?? [];
    const ids = this.news.favoriteIds();
    return feed
      .filter((n) => ids.has(n.id))
      .slice(0, MERK_NEWS_SHOWN)
      .map((n) => ({ id: `fav:${n.id}`, type: 'news' as const, title: n.title, subtitle: null, subtitleKey: `news.channels.${n.channel}`, target: { link: ['/verse/news', n.id], queryParams: null }, href: null }));
  });

  /** Open Nachschub lines for the Nachschub tab. */
  readonly supplyLines = computed(() => this.supplies.open().slice(0, 5));
}
