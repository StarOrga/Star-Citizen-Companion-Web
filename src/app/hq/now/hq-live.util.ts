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

/** A life sign older than this means the app or the game is gone (the app writes every 60 s). */
export const LIVE_PRESENCE_MAX_AGE_MS = 3 * 60 * 1000;

/** ISO time of the app's last life sign in the state, or null (older app, no signal yet). */
export function presenceAt(state: Record<string, unknown> | null): string | null {
  const p = state?.['presence'];
  return p && typeof p === 'object' ? str((p as Record<string, unknown>)['at']) : null;
}

/**
 * The newest session event says the game ended after `sinceMs`. An older end says nothing: the app
 * does not upload what it reads while catching up on a running game's log, so the `session.joined` of
 * a session it attached to late never arrives and the previous session's end stays the newest one.
 */
export function sessionEndedSince(eventsNewestFirst: readonly Pick<HqLiveEventRow, 'type' | 'at'>[], sinceMs: number): boolean {
  const last = eventsNewestFirst.find(
    (e) => e.type === 'session.joined' || e.type === 'session.quit' || e.type === 'disconnect',
  );
  return !!last && last.type !== 'session.joined' && Date.parse(last.at) > sinceMs;
}

/**
 * The client lost this session's server and has not rejoined (30k, back in the menu): the process
 * still runs, so the life sign stays fresh. Read from the state, which the app also rebuilds on catch-up.
 */
export function disconnectedInSession(state: Record<string, unknown> | null): boolean {
  const d = state?.['lastDisconnect'] as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object' || d['recapConsumed'] === true) return false;
  const at = Date.parse(String(d['at'] ?? ''));
  const started = Date.parse(String(state?.['sessionStartedAt'] ?? ''));
  return Number.isFinite(at) && Number.isFinite(started) && at >= started;
}

/** The game runs right now: a fresh life sign says so and nothing after it contradicts it. */
export function isGameLive(
  state: Record<string, unknown> | null,
  eventsNewestFirst: readonly Pick<HqLiveEventRow, 'type' | 'at'>[],
  now: number,
): boolean {
  const p = state?.['presence'] as Record<string, unknown> | undefined;
  const at = Date.parse(String(p?.['at'] ?? ''));
  if (p?.['gameRunning'] !== true || !Number.isFinite(at) || now - at > LIVE_PRESENCE_MAX_AGE_MS) return false;
  return !sessionEndedSince(eventsNewestFirst, at) && !disconnectedInSession(state);
}

export type LiveZone = 'restricted' | 'commDown' | 'armistice' | 'monitored' | 'unmonitored';

/**
 * The zones the current session's events put the player in, most important first; null = unknown.
 * Per zone family the newest event decides. Events from before the latest session start never count,
 * so an old session's zone cannot show as the current one.
 */
export function readZones(eventsNewestFirst: readonly Pick<HqLiveEventRow, 'type'>[]): LiveZone[] | null {
  let armistice: boolean | null = null;
  let restricted: boolean | null = null;
  let monitored: LiveZone | null = null;
  for (const { type } of eventsNewestFirst) {
    if (type === 'session.joined' || type === 'session.quit' || type === 'disconnect') break;
    if (armistice === null && type === 'armistice.entered') armistice = true;
    else if (armistice === null && type === 'armistice.exited') armistice = false;
    else if (restricted === null && type === 'restricted.entered') restricted = true;
    else if (restricted === null && type === 'restricted.exited') restricted = false;
    else if (monitored === null && type === 'monitored.down') monitored = 'commDown';
    else if (monitored === null && (type === 'monitored.restored' || type === 'monitored.entered')) monitored = 'monitored';
    else if (monitored === null && type === 'monitored.exited') monitored = 'unmonitored';
  }
  const zones: LiveZone[] = [];
  if (restricted) zones.push('restricted');
  if (monitored === 'commDown') zones.push('commDown');
  if (armistice) zones.push('armistice');
  if (monitored && monitored !== 'commDown') zones.push(monitored);
  return zones.length ? zones : null;
}

/** How long a destroyed ship stays marked: there is no event that says the ship is back. */
export const SHIP_DESTROYED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** A vehicle id from the game log may end in an entity number: `ANVL_Hornet_F7A_Mk2_123456`. */
const shipClassKey = (name: string): string => name.trim().replace(/_\d+$/, '').toLowerCase();

/** Time of the newest recent `vehicle.destroyed` for this ship class, or null. */
export function lastDestroyedAt(
  eventsNewestFirst: readonly Pick<HqLiveEventRow, 'type' | 'data' | 'at'>[],
  shipClassName: string,
  now: number,
): string | null {
  const key = shipClassKey(shipClassName);
  for (const e of eventsNewestFirst) {
    if (e.type !== 'vehicle.destroyed') continue;
    const ship = str(e.data?.['ship']);
    if (!ship || shipClassKey(ship) !== key) continue;
    return now - Date.parse(e.at) <= SHIP_DESTROYED_MAX_AGE_MS ? e.at : null;
  }
  return null;
}

/**
 * Readable name of a game location id: `Stanton4_NewBabbage` -> `New Babbage`. The body prefix goes
 * (the system is shown on its own), underscores and camelCase become spaces. Plain names stay as they are.
 */
export function formatLocationName(name: string): string {
  const body = name.trim().replace(/^(?:stanton|pyro|nyx|terra)\d*[a-z]?_/i, '');
  return body.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim() || name.trim();
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

const KNOWN_EVENTS = ['shop.purchase', 'refinery.complete', 'contract.completed', 'qt.arrived', 'hangar.ready', 'inventory.opened', 'blueprint.received'];

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

/**
 * A stored place as the reader sees it. The DB stores the literal `Bei mir` (PLACE_WITH_ME); in EN
 * it displays as `With me`. Everything else goes through {@link formatLocationName}.
 */
export function placeLabel(name: string, lang: string | null | undefined): string {
  if (name.trim() === 'Bei mir' && (lang ?? '').toLowerCase().startsWith('en')) return 'With me';
  return formatLocationName(name);
}
