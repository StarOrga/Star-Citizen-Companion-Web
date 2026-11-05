import { Injectable, inject, signal } from '@angular/core';
import { CodexService, pickLocalized } from '../../codex/codex.service';
import { BuyOption, UexShopService } from '../../codex/uex-shop.service';
import { logWarn } from '../../core/log';
import type { MapPlace } from './map/hq-map.types';
import { placeDistance } from './map/hq-places';
import { SourceHit, resolveSources } from './map/hq-sources';
import { slug } from './map/hq-route';

/** Shop lookups at once: each can hit several UEX lists on a cold tab. */
const IN_FLIGHT = 3;

/** One place an item can be bought. */
export interface NeedSource extends SourceHit {
  terminal: string | null;
}

export interface NeedSources {
  state: 'loading' | 'ready';
  /** Codex kind of the item once it is resolved, for its link. */
  kind: string | null;
  /** Cheapest first, one per place. */
  options: readonly NeedSource[];
}

export function buyPlace(o: BuyOption): MapPlace | null {
  if (!o.place) return null;
  const system = o.system ?? '';
  const planet = o.planet && o.planet !== o.place ? o.planet : null;
  return {
    id: [system, planet, o.place].filter((p): p is string => !!p).map(slug).join('/'),
    system,
    planet,
    location: o.place,
  };
}

export function toNeedSources(options: readonly BuyOption[]): NeedSource[] {
  const terminals = new Map<string, string>();
  const codex = options.flatMap((o) => {
    const place = buyPlace(o);
    if (!place) return [];
    if (!terminals.has(place.id)) terminals.set(place.id, o.terminal);
    return [{ place, price: o.price }];
  });
  return resolveSources({ codex }).map((hit) => ({ ...hit, terminal: terminals.get(hit.place.id) ?? null }));
}

/** The default stop: the nearest place when the reader's position is known, else the cheapest. */
export function bestSource(options: readonly NeedSource[], here: MapPlace | null): NeedSource | null {
  if (options.length === 0) return null;
  if (!here) return options[0];
  return options.reduce((best, o) => (placeDistance(here, o.place) < placeDistance(here, best.place) ? o : best));
}

/** The options as the reader wants to choose: nearest first, then cheapest (price order without a position). */
export function sourcesByDistance(options: readonly NeedSource[], here: MapPlace | null): readonly NeedSource[] {
  if (!here) return options;
  return [...options].sort(
    (a, b) => placeDistance(here, a.place) - placeDistance(here, b.place) || (a.price ?? Infinity) - (b.price ?? Infinity),
  );
}

/**
 * Where a Nachschub line can be bought (D43, the source the map was waiting for): the item's English
 * name from the Codex, matched against UEX shop prices. Results stay for the tab's lifetime; a
 * failed lookup reads as "no shop known", never as an error.
 */
@Injectable({ providedIn: 'root' })
export class HqNeedSourcesService {
  private readonly codex = inject(CodexService);
  private readonly uex = inject(UexShopService);

  private readonly state = signal<ReadonlyMap<string, NeedSources>>(new Map());
  readonly sources = this.state.asReadonly();

  /** Starts the lookup of every class name not asked for yet. */
  ensure(classNames: readonly string[]): void {
    const known = this.state();
    const fresh = [...new Set(classNames.filter((c) => c && !known.has(c)))];
    if (fresh.length === 0) return;
    this.state.update((m) => {
      const next = new Map(m);
      for (const c of fresh) next.set(c, { state: 'loading', kind: null, options: [] });
      return next;
    });
    void this.lookup(fresh);
  }

  private async lookup(classNames: readonly string[]): Promise<void> {
    let entities: Awaited<ReturnType<CodexService['resolveEntities']>> = new Map();
    try {
      entities = await this.codex.resolveEntities([...classNames]);
    } catch (err) {
      logWarn('hq', 'need sources: entities failed', err);
    }
    const queue = [...classNames];
    const worker = async (): Promise<void> => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const e = entities.get(c);
        let options: readonly BuyOption[] = [];
        if (e) {
          const name = (e.name ? pickLocalized(e.name, 'en') : '') || e.nameLocalized || c;
          options = e.kind === 'ship' ? await this.uex.whereToBuyShip({ name }, Infinity) : await this.uex.whereToBuyEntity(e.kind, name);
        }
        this.set(c, { state: 'ready', kind: e?.kind ?? null, options: toNeedSources(options) });
      }
    };
    await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  }

  private set(className: string, value: NeedSources): void {
    this.state.update((m) => new Map(m).set(className, value));
  }
}
