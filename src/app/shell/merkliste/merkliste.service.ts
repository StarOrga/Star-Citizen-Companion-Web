import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { ConsentService } from '../../core/consent.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqInventoryService } from '../../hq/data/hq-inventory.service';
import { BLUEPRINT_PLACE } from '../../hq/nachschub/sammlung.model';
import { SammlungService } from '../../hq/nachschub/sammlung.service';
import { hqShipLink, hqStockLink, type HqPageLink } from '../../hq/hq-routes';
import { categoryOf } from '../../hq/stock/hq-stock-model';
import { NewsService } from '../../news/news.service';
import { WishCartService } from '../cart/wish-cart.service';
import { bestandContextOf, lastAdded, type BestandContext } from '../cart/wish-cart.model';
import { readRecentRows, type StoredRow } from '../fusion-bar/search-recent-rows';
import {
  MERK_CONTEXT_SHOWN,
  MERK_RECENT_MAX,
  MERK_WISH_SHOWN,
  merkTypeOf,
  recentRowsOfType,
  wishTypeOf,
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

/** The context Bestand section: which one, its rows, and the "Gesamtes ..." deep link carrying the type filter. */
export interface QuickContext {
  readonly ctx: BestandContext;
  readonly rows: readonly MerkRow[];
  readonly all: HqPageLink;
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
 * Everything the header Schnellzugriff shows (concept nachschub-hq r4-d1-s1): the page type, the recently opened
 * entries of that type (up to 7), the last three wished (of the type, else overall) and the context Bestand section -
 * Inventar, Hangar or Sammlung, strictly filtered by the type, the last three added there. No Nachschub, no count.
 * Local-only data (recent rows, read log) never leaves the device.
 */
@Injectable({ providedIn: 'root' })
export class MerklisteService {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly cart = inject(WishCartService);
  private readonly hangar = inject(HangarService);
  private readonly inventory = inject(HqInventoryService);
  private readonly sammlung = inject(SammlungService);
  private readonly news = inject(NewsService);
  private readonly consent = inject(ConsentService);

  private readonly url = signal(this.router.url);
  readonly type = computed<MerkType | null>(() => merkTypeOf(this.url()));

  private readonly recents = signal<StoredRow[]>(readRecentRows(storage()));
  private readonly reads = signal<ReadEntry[]>(readReads());

  /** The href of "Ganze Wunschliste": this page with the cart open (own URL; a plain click opens it in place). */
  readonly cartHref = computed(() => {
    const tree = this.router.parseUrl(this.url());
    tree.queryParams = { ...tree.queryParams, cart: '1' };
    return this.router.serializeUrl(tree);
  });

  constructor() {
    this.router.events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      this.url.set(e.urlAfterRedirects);
      this.noteNewsRead(e.urlAfterRedirects);
    });
    effect(() => {
      if (this.auth.user()) void this.inventory.load();
    });
  }

  /** The panel opens: pick up what the search wrote since, and the stock the context section reads. */
  refresh(): void {
    this.recents.set(readRecentRows(storage()));
    this.reads.set(readReads());
    void this.inventory.load();
    void this.hangar.loadAll();
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

  // ------------------------------------------------------------------------------------------ Zuletzt geöffnet

  /** Up to seven recently opened rows of the page type; the panel shows three until "Mehr anzeigen". */
  readonly recent = computed<MerkRow[]>(() => {
    const type = this.type();
    if (type === 'news') {
      return this.reads()
        .slice(0, MERK_RECENT_MAX)
        .map((r) => newsRow(`read:${r.id}`, r.id, r.title, r.channel));
    }
    return recentRowsOfType(this.recents(), type).slice(0, MERK_RECENT_MAX);
  });

  // ------------------------------------------------------------------------------------------ Wunschliste

  /**
   * The last three added to the wishlist: of the page type when there are any, else overall - no hint either way. A page
   * without a type shows the overall newest.
   */
  readonly wished = computed<MerkRow[]>(() => {
    const type = this.type();
    const rowOf = (i: ReturnType<WishCartService['newest']>[number]): MerkRow | null =>
      wishRowOfType({ kind: i.kind, className: i.className, name: this.cart.nameOf(i), manufacturer: i.manufacturer, qty: i.qty, forClassName: i.forClassName }, null);
    // Filter first, then take three: a position the panel cannot draw must not eat one of the three places.
    const drawable = (i: ReturnType<WishCartService['newest']>[number]): boolean => rowOf(i) !== null;
    const typed = type ? this.cart.newest(MERK_WISH_SHOWN, (i) => drawable(i) && wishTypeOf(i) === type) : [];
    const picked = typed.length ? typed : this.cart.newest(MERK_WISH_SHOWN, drawable);
    return picked.map(rowOf).filter((r): r is MerkRow => !!r);
  });

  /** "Ganze Wunschliste · N Positionen". */
  readonly wishCount = this.cart.count;

  // ------------------------------------------------------------------------------------------ Inventar / Hangar / Sammlung

  /** The context section of the page type, or null on a page without one (no Bestand section there). */
  readonly context = computed<QuickContext | null>(() => {
    const ctx = bestandContextOf(this.type());
    if (!ctx) return null;
    const all = hqStockLink({ tab: ctx.tab, cat: ctx.cat });
    switch (ctx.id) {
      case 'hangar': {
        const ships = this.hangar.ships().filter((s) => s.status === 'owned');
        const rows = lastAdded(ships, MERK_CONTEXT_SHOWN).map<MerkRow>((s) => {
          const link = hqShipLink(s.id);
          return {
            id: `hangar:${s.id}`,
            type: 'ship',
            title: s.customName?.trim() || this.cart.nameOf({ kind: 'ship', className: s.shipClassName, name: null }),
            subtitle: null,
            target: { link: link.commands, queryParams: link.queryParams },
            href: null,
            kind: 'ship',
            className: s.shipClassName,
            qty: s.qty ?? 1,
          };
        });
        return { ctx, rows, all };
      }
      case 'sammlung': {
        if (this.type() === 'news') {
          const ids = this.sammlung.news();
          const feed = this.news.feed()?.news ?? [];
          const rows = feed.filter((n) => ids.has(n.id)).slice(0, MERK_CONTEXT_SHOWN).map((n) => newsRow(`sam:${n.id}`, n.id, n.title, n.channel));
          return { ctx, rows, all };
        }
        const bps = this.inventory.items().filter((i) => i.location === BLUEPRINT_PLACE);
        const rows = lastAdded(bps.map((i) => ({ i, createdAt: i.updated_at })), MERK_CONTEXT_SHOWN).map<MerkRow>(({ i }) => ({
          id: `sam:${i.class_name ?? i.name}`,
          type: 'blueprint',
          title: i.name,
          subtitle: null,
          target: i.class_name ? { link: ['/codex', 'blueprint', i.class_name], queryParams: null } : { link: all.commands, queryParams: all.queryParams ?? null, fragment: all.fragment },
          href: null,
          kind: 'blueprint',
          className: i.class_name ?? undefined,
        }));
        return { ctx, rows, all };
      }
      default: {
        const stock = this.inventory.items().filter((i) => i.location !== BLUEPRINT_PLACE && categoryOf(i) === ctx.cat);
        const rows = lastAdded(stock.map((i) => ({ i, createdAt: i.updated_at })), MERK_CONTEXT_SHOWN).map<MerkRow>(({ i }) => {
          const link = hqStockLink({ tab: 'inventar', cat: ctx.cat, focus: i.class_name ?? i.name });
          return {
            id: `inv:${i.location}:${i.class_name ?? i.name}`,
            type: this.type() ?? 'item',
            title: i.name,
            subtitle: null,
            target: { link: link.commands, queryParams: link.queryParams ?? null, fragment: link.fragment },
            href: null,
            kind: this.type() === 'weapon' ? 'weapon' : this.type() === 'component' ? 'component' : 'item',
            className: i.class_name ?? undefined,
            qty: Number(i.qty),
          };
        });
        return { ctx, rows, all };
      }
    }
  });
}

function newsRow(id: string, newsId: string, title: string, channel: string): MerkRow {
  return { id, type: 'news', title, subtitle: null, subtitleKey: `news.channels.${channel}`, target: { link: ['/verse/news', newsId], queryParams: null }, href: null };
}
