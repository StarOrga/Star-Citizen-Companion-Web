import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';
import type { ConfigLoadoutEntry, HangarShipConfig } from '../../hangar/hangar.types';
import type { ShipPayload } from '../codex.types';
import { CodexDetail, CodexKind, CodexService, ResolvedEntity } from '../codex.service';
import { ammoClassNamesFor } from '../codex-equipped-stats';
import {
  DraftMap,
  EMPTY_DRAFT,
  HydrationEpoch,
  LOCAL_DRAFT_STORAGE_KEY,
  acceptedClassNames,
  beginHydration,
  changedCount as draftChangedCount,
  decodeDraftParam,
  deleteDraftPaths,
  encodeDraftParam,
  extendHydration,
  isNestedPath,
  mergeMapInto,
  mergeSavedLoadout,
  newHydrationEpoch,
  parseLocalDraft,
  restoreDraft,
  selectSaveableEntries,
  serializeLocalDraft,
  setDraftValueForPaths,
  topSegment,
  touchedTopPorts,
} from '../codex-loadout-draft';
import type { SwapPick } from '../codex-swap-picker.component';
import { CodexHoloForkGuard } from '../holo/codex-holo-fork-guard';
import { stockLoadoutClassNames } from '../stock-loadout';
import type { LoadoutItem } from './codex-detail.types';

/** What the store needs from the page, handed in once by connect(). */
export interface LoadoutDraftSources {
  detail: Signal<CodexDetail | null>;
  loadoutEntities: Signal<Map<string, ResolvedEntity>>;
  loadoutAll: Signal<LoadoutItem[]>;
  /** codex_item_ports.port_name — the only paths a draft entry can be saved against (R2). */
  joinablePorts: Signal<ReadonlySet<string>>;
  /** A save wrote this config (the share popover snapshots it, wave 5 A1.4). */
  onSaved(config: HangarShipConfig): void;
}

/** Who shared the loadout on the table while it is read-only (#646). */
export interface ReadOnlyDraftSource {
  token: string;
  ownerName: string | null;
  configName: string;
}

const NO_DETAIL = signal<CodexDetail | null>(null);
const NO_ENTITIES = signal(new Map<string, ResolvedEntity>());
const NO_LOADOUT = signal<LoadoutItem[]>([]);
const NO_PORTS = signal<ReadonlySet<string>>(new Set());

/**
 * The loadout draft of a ship's codex page (PR B — 06-fallen.md), lifted out
 * of codex-detail (AUD-090, seam 2): the draft itself, its hydration, the
 * URL/localStorage mirror and the save into the hangar.
 *
 * Provided by CodexDetailComponent, so the classic view and the Holotable
 * share one draft. The page keeps the DERIVED views that join the draft with
 * the loadout (draft overlay, module sections, summary occupants) and reads
 * the draft signals from here.
 *
 * Model per 03-rules §2.4: Map<rawPath, className|null>. `null` = emptied,
 * distinct from "absent" = unchanged. Only mutated through the pure helpers
 * in codex-loadout-draft.ts so the app/spec logic never drifts.
 */
@Injectable()
export class CodexLoadoutDraftStore {
  private readonly svc = inject(CodexService);
  private readonly hangar = inject(HangarService);
  private readonly forkGuard = inject(CodexHoloForkGuard);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly t = inject(TranslateService);

  private src: LoadoutDraftSources = {
    detail: NO_DETAIL,
    loadoutEntities: NO_ENTITIES,
    loadoutAll: NO_LOADOUT,
    joinablePorts: NO_PORTS,
    onSaved: () => undefined,
  };

  private readonly draftState = signal<DraftMap>(EMPTY_DRAFT);
  readonly draft = this.draftState.asReadonly();
  /** Payloads for DRAFT-swapped classes — merged in, never a wholesale replace (R6). */
  private readonly draftPayloadsState = signal<Map<string, { kind: CodexKind; payload: unknown }>>(new Map());
  readonly draftPayloads = this.draftPayloadsState.asReadonly();
  private readonly draftAmmoPayloadsState = signal<Map<string, unknown>>(new Map());
  readonly draftAmmoPayloads = this.draftAmmoPayloadsState.asReadonly();
  private readonly draftResolvedState = signal<Map<string, ResolvedEntity>>(new Map());
  readonly draftResolved = this.draftResolvedState.asReadonly();
  /** Classes currently being hydrated — rows render no numbers while pending (Falle 2). */
  private readonly pendingClasses = signal<ReadonlySet<string>>(new Set());
  /** Paths whose restored draft class does not resolve in the current build (R9). */
  private readonly unresolvableState = signal<ReadonlySet<string>>(new Set());
  readonly unresolvableDraftPaths = this.unresolvableState.asReadonly();
  /** Paths whose current draft value is already reflected in the stored config. */
  private readonly savedPathsState = signal<ReadonlySet<string>>(new Set());
  readonly savedPaths = this.savedPathsState.asReadonly();
  private readonly hydrationEpoch: HydrationEpoch = newHydrationEpoch();
  private readonly savingState = signal(false);
  readonly saving = this.savingState.asReadonly();
  private readonly saveErrorState = signal<string | null>(null);
  readonly saveError = this.saveErrorState.asReadonly();
  /** A shared link's loadout shown read-only (#646): no swap, revert or save
   * until the reader adopts it, and nothing of it reaches the URL or the
   * reader's own local draft. */
  private readonly readOnlySourceState = signal<ReadOnlyDraftSource | null>(null);
  readonly readOnlySource = this.readOnlySourceState.asReadonly();
  readonly readOnly = computed(() => this.readOnlySourceState() !== null);
  /** The config a save writes to when the page was opened on one (`?config=`,
   * #646) — otherwise the ship's active config, as before. */
  private targetConfigId: string | null = null;

  readonly draftChangedCount = computed(() => draftChangedCount(this.draftState()));
  readonly saveableEntries = computed(() =>
    selectSaveableEntries(this.draftState(), this.src.joinablePorts(), (cn) => this.kindOfDraftClass(cn)),
  );

  /** The page hands in its signals once, from its constructor. */
  connect(sources: LoadoutDraftSources): void {
    this.src = sources;
  }

  /** A new entity loads: every trace of the previous draft goes. */
  reset(): void {
    this.draftState.set(EMPTY_DRAFT);
    this.draftPayloadsState.set(new Map());
    this.draftAmmoPayloadsState.set(new Map());
    this.draftResolvedState.set(new Map());
    this.pendingClasses.set(new Set());
    this.unresolvableState.set(new Set());
    this.savedPathsState.set(new Set());
    this.saveErrorState.set(null);
    this.readOnlySourceState.set(null);
    this.targetConfigId = null;
  }

  /**
   * Put a stored loadout (a hangar config's, or a shared link's snapshot) on
   * the table as the draft (#646): every top-level entry that differs from
   * the stock occupant becomes a draft entry and is hydrated like a swap.
   *
   * - `readOnly` set: a shared link — swaps, reverts and saves are refused
   *   until the reader adopts it, and the draft is NOT mirrored into the URL
   *   or localStorage (it is not the reader's own draft).
   * - `configId` set: the reader's own config — its entries count as saved
   *   and a later save writes to exactly this config.
   */
  applyStoredLoadout(
    entries: readonly ConfigLoadoutEntry[],
    opts: { readOnly?: ReadOnlyDraftSource; configId?: string } = {},
  ): void {
    const draft = new Map<string, string | null>();
    for (const e of entries) {
      if (!e?.portName || isNestedPath(e.portName) || !e.className) continue;
      if (e.className !== this.stockValueForPath(e.portName)) draft.set(e.portName, e.className);
    }
    this.draftState.set(draft);
    this.unresolvableState.set(new Set());
    this.saveErrorState.set(null);
    this.readOnlySourceState.set(opts.readOnly ?? null);
    this.targetConfigId = opts.configId ?? null;
    this.savedPathsState.set(opts.configId ? new Set(draft.keys()) : new Set());
    for (const value of new Set(draft.values())) {
      if (value) void this.hydrateDraftClass(value);
    }
    if (!opts.readOnly) this.persistDraftMirror();
  }

  private kindOfDraftClass(className: string): string {
    return (
      this.draftResolvedState().get(className)?.kind ??
      this.src.loadoutEntities().get(className)?.kind ??
      'component'
    );
  }

  /**
   * "Übernehmen" / "Slot leeren" from the picker — applies to every covered
   * path. Closing the picker is the page's job (it owns the swap target).
   */
  applySwap(pick: SwapPick): void {
    if (this.readOnly()) return;
    const paths = pick.target.rawPorts && pick.target.rawPorts.length > 0 ? pick.target.rawPorts : [];
    // No raw identity to write against — nothing we can do safely.
    if (paths.length === 0) return;
    this.draftState.update((d) =>
      setDraftValueForPaths(d, paths, pick.className, (path) => this.stockValueForPath(path)),
    );
    this.unresolvableState.update((s) => {
      if (paths.every((p) => !s.has(p))) return s;
      const next = new Set(s);
      for (const p of paths) next.delete(p);
      return next;
    });
    if (pick.className) void this.hydrateDraftClass(pick.className);
    this.persistDraftMirror();
  }

  /** Revert the row's own draft entries (the ↺ button). */
  onRevertPaths(paths: string[]): void {
    if (paths.length === 0 || this.readOnly()) return;
    this.draftState.update((d) => deleteDraftPaths(d, paths));
    this.persistDraftMirror();
  }

  /** The STOCK value at a dotted path — top-level className, or a carried sub-port's. */
  stockValueForPath(path: string): string | null {
    const top = topSegment(path);
    const item = this.src.loadoutAll().find((l) => l.port === top);
    if (!item) return null;
    if (!isNestedPath(path)) return item.className;
    const childPort = path.slice(top.length + 1).toLowerCase();
    for (const [k, v] of item.carried) {
      if (k.toLowerCase() === childPort) return v;
    }
    return null;
  }

  /**
   * Async stat hydration for a draft-swapped class, epoch-guarded (R6/Falle 2).
   * The round is fetched AFTER the entity payload, because the payload is
   * what names it (`weaponParams.ammoClassName`, schema 6) — a swapped-in
   * launcher must show ITS round's values, not a name-convention guess.
   */
  private async hydrateDraftClass(className: string): Promise<void> {
    this.pendingClasses.update((s) => new Set(s).add(className));
    const epoch = beginHydration(this.hydrationEpoch, [className]);
    try {
      const [payloads, resolved] = await Promise.all([
        this.svc.getEntityPayloads([className]),
        this.svc.resolveEntities([className]),
      ]);
      const ammoNames = ammoClassNamesFor([className], (cn) => payloads.get(cn)?.payload);
      extendHydration(this.hydrationEpoch, ammoNames, epoch);
      const ammo =
        ammoNames.length > 0 ? await this.svc.getAmmoPayloads(ammoNames) : new Map<string, unknown>();
      const okMain = acceptedClassNames(this.hydrationEpoch, [className], epoch);
      const okAmmo = acceptedClassNames(this.hydrationEpoch, ammoNames, epoch);
      if (okMain.length > 0) {
        this.draftPayloadsState.update((m) => mergeMapInto(m, payloads, okMain));
        this.draftResolvedState.update((m) => mergeMapInto(m, resolved, okMain));
      }
      if (okAmmo.length > 0) this.draftAmmoPayloadsState.update((m) => mergeMapInto(m, ammo, okAmmo));
    } catch (error) {
      logWarn('codex', 'draft hydration failed', error);
      // A failed hydration just leaves the row pending forever rather than
      // rendering wrong numbers — Falle 2: "a spinner beats a wrong number".
    } finally {
      if (acceptedClassNames(this.hydrationEpoch, [className], epoch).length > 0) {
        this.pendingClasses.update((s) => {
          const next = new Set(s);
          next.delete(className);
          return next;
        });
      }
    }
  }

  isDraftClassPending(className: string | null): boolean {
    return !!className && this.pendingClasses().has(className);
  }

  // ── persistence (R1/R2) ──────────────────────────────────────────────────

  /**
   * Write the draft into the ship's ACTIVE hangar config (creating + activating
   * one when it has none). Never a from-scratch array: only OUR joinable,
   * top-level paths are upserted/removed; every other row the config already
   * carries — including ones the hangar editor wrote — survives untouched.
   */
  async saveLoadoutDraft(): Promise<HangarShipConfig | null> {
    const d = this.src.detail();
    if (d?.kind !== 'ship' || this.saveableEntries().length === 0 || this.readOnly()) return null;
    this.savingState.set(true);
    this.saveErrorState.set(null);
    try {
      const ship =
        this.hangar.shipByClassName(d.classNameSlug) ?? (await this.hangar.addShip(d.classNameSlug, 'owned'));
      if (!ship) {
        this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
        return null;
      }
      const configs = await this.hangar.listConfigs(ship.id);
      let target: HangarShipConfig | null =
        configs.find((c) => c.id === this.targetConfigId) ?? configs.find((c) => c.isActive) ?? configs[0] ?? null;
      if (!target) {
        target = await this.hangar.createConfig(
          ship.id,
          this.t.instant('codex.loadout.defaultConfigName') as string,
          'multipurpose',
          [],
        );
        if (!target) {
          this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
          return null;
        }
        await this.hangar.activateConfig(target.id, ship.id);
      }
      const touched = touchedTopPorts(this.draftState(), this.src.joinablePorts());
      const merged = mergeSavedLoadout(target.loadout, this.saveableEntries(), touched);
      // Wave 2.5 (fork guard, wave2-patch-share.md §D): a config the viewer
      // only FOLLOWS may never be edited directly — offer the one-time fork
      // before this write, abort silently on decline.
      const guard = await this.forkGuard.ensureEditable(target);
      if (guard === 'cancelled') return null;
      const updated =
        guard === 'forked'
          ? await this.hangar.forkFollowedLoadout(target.id, { loadout: merged })
          : await this.hangar.updateConfig(target.id, { loadout: merged });
      if (!updated) {
        this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorGeneric') as string);
        return null;
      }
      this.savedPathsState.set(new Set(this.saveableEntries().map((e) => e.portName)));
      // The share popover snapshots the page's active config — hand it the
      // config that was just written, not the one loaded at page open.
      this.src.onSaved(updated);
      return updated;
    } catch (error) {
      logWarn('codex', 'loadout save failed', error);
      this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorGeneric') as string);
      return null;
    } finally {
      this.savingState.set(false);
    }
  }

  discardLoadoutDraft(): void {
    const target = this.targetConfigId;
    this.reset();
    this.targetConfigId = target;
    this.persistDraftMirror();
  }

  // ── URL + localStorage draft mirror (R9) ────────────────────────────────

  /** Best-effort — try/catch throughout: private-mode localStorage still must not break the page. */
  private persistDraftMirror(): void {
    const d = this.src.detail();
    const buildId = this.svc.build()?.id;
    if (!d || d.kind !== 'ship' || !buildId) return;
    try {
      const param = encodeDraftParam(buildId, this.draftState());
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { loadout: param },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch (error) {
      logWarn('codex', 'draft url mirror failed', error);
      // Router navigation should not throw in practice — best-effort regardless.
    }
    try {
      if (typeof localStorage === 'undefined') return;
      if (this.draftState().size === 0) localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
      else localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, serializeLocalDraft(d.classNameSlug, buildId, this.draftState()));
    } catch {
      // Private mode / quota — degrade to in-memory only.
    }
  }

  /** URL wins over localStorage; both are ignored when the ship or build doesn't match (R9). */
  restoreDraftFromUrlOrStorage(classNameSlug: string): void {
    const buildId = this.svc.build()?.id;
    if (!buildId) return;
    const fromUrl = decodeDraftParam(this.route.snapshot.queryParamMap.get('loadout'));
    let entries: [string, string | null][] | null = null;
    let sourceBuildId = buildId;
    if (fromUrl) {
      entries = fromUrl.entries;
      sourceBuildId = fromUrl.buildId;
    } else {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
        const local = parseLocalDraft(raw);
        if (local && local.shipClassName === classNameSlug) {
          entries = local.entries;
          sourceBuildId = local.buildId;
        }
      } catch {
        // Private mode — no restore, page still works.
      }
    }
    if (!entries || entries.length === 0) return;
    const classResolves = (className: string): boolean =>
      this.src.loadoutEntities().has(className) || stockLoadoutClassNames(
        (this.src.detail()?.payload as ShipPayload | undefined)?.defaultLoadout ?? [],
      ).includes(className);
    const restored = restoreDraft({ version: 'v1', buildId: sourceBuildId, entries }, buildId, classResolves);
    this.draftState.set(restored.draft);
    this.unresolvableState.set(new Set(restored.unresolvable));
    // A restored draft is UNSAVED by definition (R8) — savedPaths stays empty.
    for (const [path, value] of restored.draft) {
      if (value && !restored.unresolvable.includes(path)) void this.hydrateDraftClass(value);
    }
    // A draft that came back from localStorage is mirrored into the url so
    // "Link kopieren" carries what the table shows (wave 5 A1.2).
    if (!fromUrl) this.persistDraftMirror();
  }
}
