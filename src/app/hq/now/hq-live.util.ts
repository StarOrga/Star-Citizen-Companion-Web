import { HqLiveEventRow } from '../data/hq-db.types';

export interface LiveLocation {
  name: string;
  system: string | null;
}
export interface LiveContract {
  missionId: string;
  name: string;
  acceptedAt: string | null;
  objective: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** True when the newest session event says the game is closed: the state is then only the last known one. */
export function sessionEnded(eventsNewestFirst: readonly Pick<HqLiveEventRow, 'type'>[]): boolean {
  const last = eventsNewestFirst.find(
    (e) => e.type === 'session.joined' || e.type === 'session.quit' || e.type === 'disconnect',
  );
  return !!last && last.type !== 'session.joined';
}

export function readLocation(state: Record<string, unknown> | null): LiveLocation | null {
  const l = state?.['location'];
  if (typeof l === 'string') return str(l) ? { name: l.trim(), system: null } : null;
  if (!l || typeof l !== 'object') return null;
  const o = l as Record<string, unknown>;
  const name = str(o['name']);
  return name ? { name, system: str(o['system']) } : null;
}

export function readShip(state: Record<string, unknown> | null): string | null {
  const s = state?.['currentShip'];
  if (typeof s === 'string') return str(s);
  if (s && typeof s === 'object') {
    const o = s as Record<string, unknown>;
    return str(o['name']) ?? str(o['className']);
  }
  return null;
}

export function readContracts(state: Record<string, unknown> | null): LiveContract[] {
  const c = state?.['contracts'];
  if (!Array.isArray(c)) return [];
  return c
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      missionId: str(x['missionId']) ?? '',
      name: str(x['name']) ?? str(x['missionId']) ?? '',
      acceptedAt: str(x['acceptedAt']),
      objective: str(x['objective']),
    }))
    .filter((x) => x.name);
}

const KNOWN_EVENTS = ['shop.purchase', 'refinery.complete', 'contract.completed', 'qt.arrived', 'hangar.ready', 'inventory.opened'];

/** i18n key + params of an event line; unknown types fall back to a generic line that names the type. */
export function eventLabel(ev: Pick<HqLiveEventRow, 'type' | 'data'>): { key: string; params: Record<string, unknown> } {
  const d = ev.data ?? {};
  const params: Record<string, unknown> = {
    item: str(d['item']) ?? '',
    shop: str(d['shop']) ?? '',
    location: str(d['location']) ?? '',
    name: str(d['name']) ?? '',
    count: typeof d['count'] === 'number' ? d['count'] : 1,
    quantity: typeof d['quantity'] === 'number' ? d['quantity'] : 1,
    type: ev.type,
  };
  return KNOWN_EVENTS.includes(ev.type) ? { key: `hq.log.event.${ev.type}`, params } : { key: 'hq.log.event.other', params };
}

/** Local calendar day key `YYYY-MM-DD`. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
