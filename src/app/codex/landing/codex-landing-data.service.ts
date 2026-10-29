import { Injectable, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AccountPrefsService } from '../../core/account-prefs.service';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { NewsService } from '../../news/news.service';
import { patchLineOf } from '../../news/patch-notes';
import { CodexBuildDiffService } from '../codex-build-diff.service';
import {
  CodexKind,
  CodexListRow,
  CodexService,
  manufacturerLabel,
  pickLocalized,
  toLang,
} from '../codex.service';
import { UpcomingShipsService, normalizeShipName } from '../upcoming-ships.service';
import {
  Filmstrip,
  FilmstripTile,
  LANDING_CATEGORIES,
  LandingCategory,
  LandingItem,
  LandingOverviewField,
  LandingPaint,
  LandingValue,
  PatchSummaryView,
  RSI_PATCH_NOTES_OVERVIEW_URL,
} from './codex-landing-data.types';

/** Account pref (`profiles.ui_prefs`, via `set_ui_pref`) holding the patch version whose News the user opened last. */
export const NEWS_SEEN_PREF_KEY = 'codex.newsSeen';
/** A paint younger than this counts as "neu". */
export const NEW_PAINT_DAYS = 30;
export const MAX_TOP_VALUES = 7;
/** Candidate rows read per category before "newest" is chosen. */
const CANDIDATE_LIMIT = 200;
/**
 * "Werkzeug" = the ship utility heads of the weapon taxonomy
 * (`codex-weapon-taxonomy.ts`, group `utility`): tractor/towing beam, salvage head.
 */
export const TOOL_ATTACH_TYPES: readonly string[] = ['TractorBeam', 'TowingBeam', 'SalvageHead'];

const KIND_OF: Record<LandingCategory, CodexKind> = {
  ship: 'ship',
  fpsWeapon: 'weapon',
  armor: 'item',
  component: 'component',
  tool: 'weapon',
};

// ── pure helpers (exported for the spec) ──────────────────────────────────────

/**
 * First candidate the previous build did not have (= new this patch); else the
 * first candidate. `previous === null` (no earlier build) takes the first.
 */
export function pickNewest(candidates: readonly string[], previous: ReadonlySet<string> | null): string | null {
  if (candidates.length === 0) return null;
  if (previous) {
    const fresh = candidates.find((c) => !previous.has(c));
    if (fresh) return fresh;
  }
  return candidates[0];
}

/** Display name used to spot the same ship listed under two class names. */
function nameKey(r: Pick<CodexListRow, 'nameLocalized' | 'classNameSlug'>): string {
  return (r.nameLocalized ?? r.classNameSlug).trim().toLowerCase();
}

const DISPLAY_COPY = /_Display$/i;

/**
 * One row per display name, first-occurrence order. The catalog carries showroom
 * copies (<Ship>_Display: same name, no hull skins) next to the flyable ship;
 * the flyable row represents the group, so the holotable finds its 3D hull and
 * the filmstrip does not show the ship twice.
 */
export function dedupeByName<T extends Pick<CodexListRow, 'nameLocalized' | 'classNameSlug'>>(rows: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const k = nameKey(r);
    const cur = best.get(k);
    if (!cur || (DISPLAY_COPY.test(cur.classNameSlug) && !DISPLAY_COPY.test(r.classNameSlug))) best.set(k, r);
  }
  return [...best.values()];
}

const SHIP_VALUES: readonly { path: string; unit: LandingValue['unit'] }[] = [
  { path: 'flight.scmSpeed', unit: 'm/s' },
  { path: 'flight.maxSpeed', unit: 'm/s' },
  { path: 'hull.hp', unit: 'hp' },
  { path: 'armorHp', unit: 'hp' },
  { path: 'cargoScu', unit: 'scu' },
  { path: 'crew.size', unit: null },
  { path: 'hull.mass', unit: 'kg' },
];

function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Up to {@link MAX_TOP_VALUES} numeric values of an item. Ships use a curated
 * list (speed, hull, armour, cargo, crew, mass); every other category takes the
 * non-zero numeric scalars of `weaponParams` and the `stats.<group>.<key>` maps
 * in payload order — the extractor already orders them by relevance. Missing
 * data yields fewer values, never zeros.
 */
export function topValuesFor(category: LandingCategory, payload: unknown): LandingValue[] {
  const out: LandingValue[] = [];
  if (category === 'ship') {
    for (const { path, unit } of SHIP_VALUES) {
      const v = readPath(payload, path);
      if (isNum(v) && v !== 0) out.push({ key: path, value: v, unit });
    }
    return out.slice(0, MAX_TOP_VALUES);
  }
  const p = (payload ?? {}) as { weaponParams?: Record<string, unknown>; stats?: Record<string, Record<string, unknown>> };
  for (const [k, v] of Object.entries(p.weaponParams ?? {})) {
    if (isNum(v) && v !== 0) out.push({ key: `weaponParams.${k}`, value: v, unit: null });
  }
  for (const [group, values] of Object.entries(p.stats ?? {})) {
    if (group === 'ItemResourceComponentParams') continue; // energy plumbing, not a headline value
    for (const [k, v] of Object.entries(values ?? {})) {
      if (isNum(v) && v !== 0) out.push({ key: `stats.${group}.${k}`, value: v, unit: null });
    }
  }
  return out.slice(0, MAX_TOP_VALUES);
}

/** Overview fields per category (brief A5). Values are display text; `type`-like ones are raw catalog tokens humanised by wave 2 if null-safe. */
export function overviewFor(
  category: LandingCategory,
  row: Pick<CodexListRow, 'size' | 'grade' | 'subType' | 'attachType' | 'weaponClass' | 'componentKind' | 'role'>,
  manufacturer: string | null,
  roleText: string | null,
): LandingOverviewField[] {
  const size = row.size === null || row.size === undefined ? null : `S${row.size}`;
  switch (category) {
    case 'ship':
      return [
        { id: 'role', value: roleText },
        { id: 'size', value: null }, // ship size class: wave 2 derives it from crew/dimensions if wanted
        { id: 'manufacturer', value: manufacturer },
      ];
    case 'fpsWeapon':
    case 'tool':
      return [
        { id: 'type', value: row.subType ?? row.attachType },
        { id: 'size', value: size },
        { id: 'manufacturer', value: manufacturer },
      ];
    case 'armor':
      return [
        { id: 'part', value: row.attachType?.replace(/^Char_Armor_/, '') ?? row.subType },
        { id: 'class', value: row.grade },
        { id: 'manufacturer', value: manufacturer },
      ];
    case 'component':
      return [
        { id: 'type', value: row.componentKind },
        { id: 'size', value: size },
        { id: 'class', value: row.grade },
      ];
  }
}

/** Paint recency and the "neu" flag. */
export function paintRecency(releasedAt: string | null, firstSeenAt: string): string {
  return releasedAt ?? firstSeenAt;
}

export function isNewPaint(recencyAt: string, now = Date.now()): boolean {
  const t = Date.parse(recencyAt);
  return Number.isFinite(t) && now - t <= NEW_PAINT_DAYS * 86_400_000;
}

/** Newest first, ties by name — the order never depends on any selection. */
export function sortPaints(paints: readonly LandingPaint[]): LandingPaint[] {
  return [...paints].sort((a, b) => Date.parse(b.recencyAt) - Date.parse(a.recencyAt) || a.name.localeCompare(b.name));
}

/** Thread of exactly this patch, else the newest LIVE/any thread of its line, else null. */
export function pickPatchThread(
  groups: readonly { line: string; entries: readonly { version: string; stage: string | null; item: { url: string } }[] }[],
  patchVersion: string,
): { url: string; exact: boolean } | null {
  const group = groups.find((g) => g.line === patchLineOf(patchVersion));
  if (!group) return null;
  const exact = group.entries.find((e) => e.version === patchVersion);
  if (exact) return { url: exact.item.url, exact: true };
  const live = group.entries.find((e) => e.stage === 'live') ?? group.entries[0];
  return live ? { url: live.item.url, exact: false } : null;
}

/**
 * Data contract of the new Codex landing (concept 2026-10-29-codex-landing-neu).
 * Components only render what this service returns; all queries, fallbacks and
 * error mapping live here. See docs/concepts/2026-10-29-codex-landing-neu/briefs/contract-w1.md.
 *
 * Every async method resolves (never rejects): a failure sets {@link error}
 * to an `errors.*` key and yields the empty value (`null` / `[]`), so the page
 * can show an error state with retry instead of the empty state.
 */
@Injectable({ providedIn: 'root' })
export class CodexLandingDataService {
  private readonly codex = inject(CodexService);
  private readonly diff = inject(CodexBuildDiffService);
  private readonly upcoming = inject(UpcomingShipsService);
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(AccountPrefsService);
  private readonly news = inject(NewsService);
  private readonly translate = inject(TranslateService);

  /** `errors.*` i18n key of the last failed read; null when fine. */
  readonly error = signal<string | null>(null);

  private readonly _summary = signal<PatchSummaryView | null>(null);
  /** Patch summary of the current LIVE build, language-aware; null = none (hide the News button). */
  readonly patchSummary = computed(() => this._summary());

  /** True when a summary exists, the user is signed in, prefs are loaded and this patch was not yet opened. */
  readonly newsUnread = computed(() => {
    const s = this._summary();
    const p = this.prefs.prefs();
    if (!s || !this.auth.user() || p === null) return false;
    return p[NEWS_SEEN_PREF_KEY] !== s.patchVersion;
  });

  private newestCache = new Map<string, Promise<LandingItem | null>>();

  // ── newest item per category ───────────────────────────────────────────────

  /** Newest flight-ready item of each category, rotation order; categories without data are omitted. */
  async rotationItems(): Promise<LandingItem[]> {
    const all = await Promise.all(LANDING_CATEGORIES.map((c) => this.newestItem(c)));
    return all.filter((i): i is LandingItem => i !== null);
  }

  /** Newest flight-ready item of one category (memoised per build + category), or null. */
  newestItem(category: LandingCategory): Promise<LandingItem | null> {
    const key = `${this.codex.build()?.id ?? ''}:${category}`;
    let hit = this.newestCache.get(key);
    if (!hit) {
      // One quiet retry: the catalog read is heavy, an odd 5xx would otherwise drop the category from the rotation.
      hit = this.loadNewest(category)
        .catch(() => new Promise<void>((r) => setTimeout(r, 700)).then(() => this.loadNewest(category)))
        .catch((err) => {
          this.newestCache.delete(key);
          this.error.set(toErrorKey('codex-landing', `newest ${category}`, err));
          return null;
        });
      this.newestCache.set(key, hit);
    }
    return hit;
  }

  private async candidates(category: LandingCategory): Promise<CodexListRow[]> {
    switch (category) {
      case 'ship': {
        // New-this-patch first; the full list follows so a showroom copy that is new
        // can be swapped for its flyable sibling (see dedupeByName).
        const added = await this.diff.addedShipsMemo();
        const all = (await this.codex.listByKind('ship', { limit: CANDIDATE_LIMIT })).rows;
        return added.length ? [...added, ...all] : all;
      }
      case 'fpsWeapon':
        return this.codex.listFpsCatalog('weapon');
      case 'armor':
        return this.codex.listFpsCatalog('armor');
      case 'component':
        return (await this.codex.listByKind('component', { limit: CANDIDATE_LIMIT })).rows;
      case 'tool':
        return (
          await this.codex.listByKind('weapon', { weaponClass: 'Ship', attachTypeIn: [...TOOL_ATTACH_TYPES], limit: CANDIDATE_LIMIT })
        ).rows;
    }
  }

  private async previousClassNames(kind: CodexKind): Promise<ReadonlySet<string> | null> {
    const builds = await this.codex.recentLiveBuilds(2);
    if (builds.length < 2) return null;
    const table = { ship: 'codex_ships', weapon: 'codex_weapons', component: 'codex_components', item: 'codex_items' }[
      kind as 'ship' | 'weapon' | 'component' | 'item'
    ];
    if (!table) return null;
    const { data, error } = await this.sb.client.from(table).select('class_name').eq('build_id', builds[1].id).limit(1000);
    if (error) throw error;
    return new Set(((data ?? []) as { class_name: string }[]).map((r) => r.class_name));
  }

  private async loadNewest(category: LandingCategory): Promise<LandingItem | null> {
    const kind = KIND_OF[category];
    const rows = dedupeByName((await this.candidates(category)).filter((r) => !r.isVariant));
    const previous = category === 'ship' ? null : await this.previousClassNames(kind);
    const className = pickNewest(rows.map((r) => r.classNameSlug), previous);
    if (!className) return null;
    const detail = await this.codex.getDetail(kind, className);
    if (!detail) return null;
    const lang = toLang(this.translate.getCurrentLang() || this.translate.getFallbackLang());
    const listRow = rows.find((r) => r.classNameSlug === className) as CodexListRow;
    const row = { ...listRow, payload: detail.payload };
    const payload = detail.payload as { name?: unknown; vehicleName?: unknown; previewImage?: string | null } | null;
    const name =
      pickLocalized((payload?.vehicleName ?? payload?.name) as never, lang) || listRow.nameLocalized || className;
    const manufacturer = manufacturerLabel(row, lang);
    const roleKey = category === 'ship' ? ((detail.payload as { role?: string | null })?.role ?? listRow.role) : null;
    const roleText = roleKey ? ((await this.codex.resolveLocaleKeys([roleKey], lang)).get(roleKey) ?? null) : null;
    const overview = overviewFor(category, listRow, manufacturer, roleText);
    return {
      category,
      kind,
      className,
      name,
      eyebrow: { manufacturer, descriptor: overview.find((f) => f.id === 'role' || f.id === 'type' || f.id === 'part')?.value ?? null },
      detailRoute: ['/codex', kind, className],
      imageUrl: category === 'ship' ? await this.rsiShipImage(name) : null,
      previewUrl: this.codex.previewUrl(payload?.previewImage ?? null),
      overview,
      topValues: topValuesFor(category, detail.payload),
    };
  }

  private async rsiShipImage(name: string): Promise<string | null> {
    try {
      await this.upcoming.ensureLoaded();
    } catch {
      return null; // a dead RSI proxy must not break the landing
    }
    const art = this.upcoming.feed()?.gameShipArt?.[normalizeShipName(name)];
    return art?.thumbnails?.[0] ?? null;
  }

  // ── paints ─────────────────────────────────────────────────────────────────

  /**
   * Paints of an item that HAVE an RSI image, newest first. Only ships have
   * paints; any other kind resolves `[]`. `isNew` = younger than {@link NEW_PAINT_DAYS}.
   */
  async paintsFor(className: string, shipName?: string): Promise<LandingPaint[]> {
    try {
      const norm = shipName ? normalizeShipName(shipName) : '';
      const filter = norm ? `class_name.eq.${className},ship_norm.eq.${norm}` : `class_name.eq.${className}`;
      const { data, error } = await this.sb.client
        .from('rsi_ship_paints')
        .select('rsi_id, name, image_url, rsi_url, released_at, first_seen_at')
        .or(filter)
        .limit(500);
      if (error) throw error;
      const now = Date.now();
      return sortPaints(
        ((data ?? []) as Record<string, string | null>[])
          .filter((r) => !!r['image_url'])
          .map((r) => {
            const recencyAt = paintRecency(r['released_at'], r['first_seen_at'] as string);
            return {
              id: r['rsi_id'] as string,
              name: r['name'] as string,
              imageUrl: r['image_url'] as string,
              rsiUrl: r['rsi_url'],
              recencyAt,
              isNew: isNewPaint(recencyAt, now),
            };
          }),
      );
    } catch (err) {
      this.error.set(toErrorKey('codex-landing', 'paints', err));
      return [];
    }
  }

  // ── filmstrip ──────────────────────────────────────────────────────────────

  /** Newest flight-ready ships (new-this-patch first), at most `limit` tiles + the "+ N weitere" count. */
  async flightReadyFilmstrip(limit = 12): Promise<Filmstrip> {
    try {
      const added = await this.diff.addedShipsMemo();
      const rest = await this.codex.listByKind('ship', { limit: CANDIDATE_LIMIT });
      const newNames = new Set(added.map(nameKey));
      const ordered = dedupeByName([...added, ...rest.rows].filter((r) => !r.isVariant)).map((row) => ({
        row,
        isNew: newNames.has(nameKey(row)),
      }));
      const total = Math.max(rest.count, ordered.length);
      const lang = toLang(this.translate.getCurrentLang() || this.translate.getFallbackLang());
      await this.upcoming.ensureLoaded().catch(() => undefined);
      const art = this.upcoming.feed()?.gameShipArt ?? {};
      const tiles: FilmstripTile[] = ordered.slice(0, limit).map(({ row, isNew }) => {
        const name = row.nameLocalized ?? row.classNameSlug;
        return {
          id: row.classNameSlug,
          name,
          manufacturer: manufacturerLabel(row, lang),
          imageUrl: art[normalizeShipName(name)]?.thumbnails?.[0] ?? null,
          route: ['/codex', 'ship', row.classNameSlug],
          isNew,
        };
      });
      return { tiles, more: Math.max(total - tiles.length, 0), total };
    } catch (err) {
      this.error.set(toErrorKey('codex-landing', 'filmstrip', err));
      return { tiles: [], more: 0, total: 0 };
    }
  }

  /** Announced (not yet flight-ready) ships from the RSI feed; feed order = RSI's own. */
  async announcedFilmstrip(limit = 12): Promise<Filmstrip> {
    try {
      await this.upcoming.ensureLoaded();
      const ships = this.upcoming.concept();
      const tiles: FilmstripTile[] = ships.slice(0, limit).map((s) => ({
        id: s.id,
        name: s.name,
        manufacturer: s.manufacturer,
        imageUrl: s.thumbnails?.[0] ?? s.thumbnail,
        route: ['/codex', 'upcoming', s.id],
        isNew: this.upcoming.newIds().has(s.id),
      }));
      return { tiles, more: Math.max(ships.length - tiles.length, 0), total: ships.length };
    } catch (err) {
      this.error.set(toErrorKey('codex-landing', 'announced', err));
      return { tiles: [], more: 0, total: 0 };
    }
  }

  // ── patch summary + unread ─────────────────────────────────────────────────

  /**
   * Loads the KI summary of the current LIVE build into {@link patchSummary}
   * (language-aware, re-read after a language switch by calling again). No
   * summary or any failure leaves it `null` — the News button then stays hidden.
   */
  async loadPatchSummary(): Promise<PatchSummaryView | null> {
    try {
      const build = (await this.codex.loadCurrentBuild()) ?? null;
      if (!build) {
        this._summary.set(null);
        return null;
      }
      const { data, error } = await this.sb.client
        .from('codex_builds')
        .select('patch_summary')
        .eq('id', build.id)
        .maybeSingle();
      if (error) throw error;
      const raw = (data as { patch_summary?: { de?: unknown; en?: unknown; generated_at?: string } | null } | null)?.patch_summary;
      const lang = toLang(this.translate.getCurrentLang() || this.translate.getFallbackLang());
      const list = (raw?.[lang] ?? raw?.en ?? raw?.de) as unknown;
      const lines = Array.isArray(list) ? list.filter((l): l is string => typeof l === 'string' && !!l.trim()).slice(0, 3) : [];
      if (lines.length === 0) {
        this._summary.set(null);
        return null;
      }
      const thread = pickPatchThread(this.news.patchLines(), build.patchVersion);
      const view: PatchSummaryView = {
        patchVersion: build.patchVersion,
        lines,
        generatedAt: raw?.generated_at ?? null,
        patchNotesUrl: thread?.url ?? RSI_PATCH_NOTES_OVERVIEW_URL,
        patchNotesIsThread: thread?.exact ?? false,
      };
      this._summary.set(view);
      return view;
    } catch (err) {
      logWarn('codex-landing', 'patch summary unavailable', err);
      this.error.set(toErrorKey('codex-landing', 'patch summary', err));
      this._summary.set(null);
      return null;
    }
  }

  /** Marks the current patch's News as seen (account-wide, all devices). No-op signed out or without a summary. */
  markNewsSeen(): void {
    const s = this._summary();
    if (s) this.prefs.set(NEWS_SEEN_PREF_KEY, s.patchVersion);
  }
}
