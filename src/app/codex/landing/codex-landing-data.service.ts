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
import { formatNumber } from '../codex-format';
import {
  LANDING_CATEGORIES,
  LandingCategory,
  LandingCodex,
  LandingCodexCategory,
  LandingCodexEntry,
  LandingFact,
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
/** Newly announced ships listed under the new flight-ready ones in the Codex list. */
export const ANNOUNCED_IN_LIST = 2;
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

/** Ship values where more is better; every other ship value (crew, mass) is neutral. */
const SHIP_HIGHER_IS_BETTER: ReadonlySet<string> = new Set(['flight.scmSpeed', 'flight.maxSpeed', 'hull.hp', 'armorHp', 'cargoScu']);
/** A class needs at least this many members, else the whole category is the class. */
export const MIN_CLASS_SIZE = 3;

/**
 * The item's class: ships of the same role, other items of the same size —
 * the whole category when that group is smaller than {@link MIN_CLASS_SIZE}.
 */
export function classCohort<T extends Pick<CodexListRow, 'role' | 'size'>>(
  category: LandingCategory,
  target: Pick<CodexListRow, 'role' | 'size'>,
  rows: readonly T[],
): readonly T[] {
  let same: T[] = [];
  if (category === 'ship') {
    if (target.role) same = rows.filter((r) => r.role === target.role);
  } else if (target.size !== null && target.size !== undefined) {
    same = rows.filter((r) => r.size === target.size);
  }
  return same.length >= MIN_CLASS_SIZE ? same : rows;
}

/**
 * Adds the class mean, the class maximum and the direction to every value.
 * Only members that carry the value count (a missing value is no zero); with
 * fewer than two such members the value gets no comparison.
 */
export function withClassStats(
  category: LandingCategory,
  values: readonly LandingValue[],
  cohort: readonly Pick<CodexListRow, 'payload'>[],
): LandingValue[] {
  return values.map((v) => {
    const nums = cohort.map((r) => readPath(r.payload, v.key)).filter((n): n is number => isNum(n) && n !== 0);
    const higherIsBetter = category === 'ship' && SHIP_HIGHER_IS_BETTER.has(v.key) ? true : null;
    if (nums.length < 2) return { ...v, classAvg: null, classMax: null, higherIsBetter };
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return { ...v, classAvg: avg, classMax: Math.max(...nums), higherIsBetter };
  });
}

/** Size facts: L/W/H from the ship's bounding box, the size class for everything else. Unknown facts are left out. */
export function factsFor(category: LandingCategory, payload: unknown, size: number | null | undefined): LandingFact[] {
  if (category === 'ship') {
    const dim = (payload as { dimensions?: { length?: number; width?: number; height?: number } | null } | null)?.dimensions;
    const out: LandingFact[] = [];
    for (const id of ['length', 'width', 'height'] as const) {
      const v = dim?.[id];
      if (isNum(v) && v > 0) out.push({ id, value: `${formatNumber(v, undefined, 1)} m` });
    }
    return out;
  }
  return size === null || size === undefined ? [] : [{ id: 'size', value: `S${size}` }];
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

interface CategoryPool {
  rows: CodexListRow[];
  fresh: CodexListRow[];
  previous: ReadonlySet<string> | null;
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
  private poolCache = new Map<string, Promise<CategoryPool>>();

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

  /** Candidates of a category (deduped, no variants) and the ones new in this patch — memoised per build. */
  private pool(category: LandingCategory): Promise<CategoryPool> {
    const key = `${this.codex.build()?.id ?? ''}:${category}`;
    let hit = this.poolCache.get(key);
    if (!hit) {
      hit = this.loadPool(category);
      hit.catch(() => this.poolCache.delete(key));
      this.poolCache.set(key, hit);
    }
    return hit;
  }

  private async loadPool(category: LandingCategory): Promise<CategoryPool> {
    const rows = dedupeByName((await this.candidates(category)).filter((r) => !r.isVariant));
    if (category === 'ship') {
      const added = new Set((await this.diff.addedShipsMemo()).map(nameKey));
      return { rows, fresh: rows.filter((r) => added.has(nameKey(r))), previous: null };
    }
    const previous = await this.previousClassNames(KIND_OF[category]);
    return { rows, fresh: previous ? rows.filter((r) => !previous.has(r.classNameSlug)) : [], previous };
  }

  private async loadNewest(category: LandingCategory): Promise<LandingItem | null> {
    const kind = KIND_OF[category];
    const { rows, fresh, previous } = await this.pool(category);
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
      topValues: withClassStats(category, topValuesFor(category, detail.payload), classCohort(category, row, rows)),
      facts: factsFor(category, detail.payload, listRow.size),
      fresh: fresh.some((r) => r.classNameSlug === className),
    };
  }

  // ── Codex list: new items per category ────────────────────────────────────

  /**
   * New items of the current patch per category (rotation order), at most
   * `limit` flight-ready entries each plus the count beyond. Ships also list
   * newly announced RSI ships (tagged, not counted as new). Never rejects: a
   * category that fails comes back empty and sets {@link error}.
   */
  async codexNews(limit = 5): Promise<LandingCodex> {
    const build = await this.codex.loadCurrentBuild().catch(() => null);
    const patch = build?.patchVersion ?? null;
    const categories = await Promise.all(
      LANDING_CATEGORIES.map(async (category): Promise<LandingCodexCategory> => {
        try {
          const { fresh } = await this.pool(category);
          const ready: LandingCodexEntry[] = fresh.slice(0, limit).map((r) => ({
            id: r.classNameSlug,
            name: r.nameLocalized ?? r.classNameSlug,
            route: ['/codex', KIND_OF[category], r.classNameSlug],
            announced: false,
          }));
          let announced: LandingCodexEntry[] = [];
          if (category === 'ship') {
            await this.upcoming.ensureLoaded().catch(() => undefined);
            const ids = this.upcoming.newIds();
            announced = this.upcoming
              .concept()
              .filter((s) => ids.has(s.id))
              .map((s) => ({ id: s.id, name: s.name, route: ['/codex', 'upcoming', s.id], announced: true }));
          }
          return {
            category,
            count: fresh.length,
            entries: [...ready, ...announced.slice(0, ANNOUNCED_IN_LIST)],
            more: Math.max(0, fresh.length - ready.length),
            announced: announced.length,
          };
        } catch (err) {
          this.error.set(toErrorKey('codex-landing', `news ${category}`, err));
          return { category, count: 0, entries: [], more: 0, announced: 0 };
        }
      }),
    );
    return { patch, categories };
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
