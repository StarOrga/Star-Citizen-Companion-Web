import { Injectable, OnDestroy, Signal, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { UndoToastService } from '../../shared/undo-toast/undo-toast.service';
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
  touchedSavePaths,
} from '../codex-loadout-draft';
import type { SaveableEntry } from '../codex-loadout-draft';
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

/** Debounce of the exemplar autosave (D3): a burst of swaps within it is one save and one toast. */
export const AUTOSAVE_DEBOUNCE_MS = 1800;

interface SaveSnapshot {
  shipClass: string;
  targetId: string;
  entries: SaveableEntry[];
  touched: Set<string>;
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
export class CodexLoadoutDraftStore implements OnDestroy {
  private readonly svc = inject(CodexService);
  private readonly hangar = inject(HangarService);
  private readonly forkGuard = inject(CodexHoloForkGuard);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly t = inject(TranslateService);
  private readonly undoToast = inject(UndoToastService);

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
  private readonly autosaveOnState = signal(false);
  /** Swaps on the own exemplar save themselves (D3) — the save bar steps aside unless a save failed. */
  readonly autosave = this.autosaveOnState.asReadonly();
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly autosavePaths = new Set<string>();
  private autosaveToast: { n: number; restore: ConfigLoadoutEntry[] } | null = null;

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
    this.flushAutosave();
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
    this.flushAutosave();
    const draft = new Map<string, string | null>();
    for (const e of entries) {
      // Nested entries (`mount.gun`, D2) come back like top-level ones: stockValueForPath knows both.
      if (!e?.portName || !e.className) continue;
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
    this.scheduleAutosave(paths);
  }

  /** Revert the row's own draft entries (the ↺ button). */
  onRevertPaths(paths: string[]): void {
    if (paths.length === 0 || this.readOnly()) return;
    this.draftState.update((d) => deleteDraftPaths(d, paths));
    this.persistDraftMirror();
    this.scheduleAutosave(paths);
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

  /** The personal variant (`?v=`) a save writes to; null = codex mode, nothing saves. */
  targetConfig(): string | null {
    return this.targetConfigId;
  }

  /**
   * Write the draft into the personal variant the page shows (`?v=`). Codex
   * mode (no variant) never saves — the page offers "In dein HQ übernehmen"
   * (`adoptToHq`) instead. Never a from-scratch array: only OUR joinable
   * paths (top-level and nested, D2) are upserted/removed; every other row the
   * config already carries — including ones the hangar editor wrote — survives
   * untouched.
   */
  async saveLoadoutDraft(): Promise<HangarShipConfig | null> {
    if (this.saveableEntries().length === 0) return null;
    this.cancelAutosaveTimer();
    const extra = [...this.autosavePaths];
    this.autosavePaths.clear();
    return (await this.saveSnapshot(this.snapshot(extra)))?.updated ?? null;
  }

  /**
   * Everything a save needs from the draft, read synchronously — so a flush
   * right before a reset still writes what was shown. `extra`: paths changed
   * since the last save that the draft may no longer mention (a revert back to
   * Werk deletes the draft entry, but the stored row must go too).
   */
  private snapshot(extra: readonly string[] = []): SaveSnapshot | null {
    const d = this.src.detail();
    const targetId = this.targetConfigId;
    if (d?.kind !== 'ship' || !targetId || this.readOnly()) return null;
    const entries = this.saveableEntries();
    const touched = touchedSavePaths(this.draftState(), this.src.joinablePorts());
    for (const p of extra) touched.add(p);
    if (entries.length === 0 && touched.size === 0) return null;
    return { shipClass: d.classNameSlug, targetId, entries, touched };
  }

  /**
   * Every write of the config goes through one queue: a save reads the stored
   * loadout, merges and writes it back, so two overlapping saves (a slow
   * autosave and the next debounce, an undo right behind a save) would
   * otherwise let the older snapshot land last and drop the newer swap.
   */
  private writeQueue: Promise<unknown> = Promise.resolve();
  /** A save that forked a followed config writes to the fork from then on — also for snapshots queued before it. */
  private readonly forkedIds = new Map<string, string>();

  private serialWrite<T>(run: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  private saveSnapshot(snap: SaveSnapshot | null): Promise<{ updated: HangarShipConfig; previous: ConfigLoadoutEntry[] } | null> {
    if (!snap) return Promise.resolve(null);
    return this.serialWrite(() => this.writeSnapshot(snap));
  }

  private async writeSnapshot(queued: SaveSnapshot): Promise<{ updated: HangarShipConfig; previous: ConfigLoadoutEntry[] } | null> {
    const snap = { ...queued, targetId: this.forkedIds.get(queued.targetId) ?? queued.targetId };
    this.savingState.set(true);
    this.saveErrorState.set(null);
    try {
      const ship = this.hangar.shipByClassName(snap.shipClass);
      const configs = ship ? await this.hangar.listConfigs(ship.id) : [];
      const target = configs.find((c) => c.id === snap.targetId) ?? null;
      if (!target) {
        this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
        return null;
      }
      const previous = [...(target.loadout ?? [])];
      const merged = mergeSavedLoadout(previous, snap.entries, snap.touched);
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
        this.saveErrorState.set(this.t.instant(this.hangar.error?.() ?? 'codex.loadout.saveErrorGeneric') as string);
        return null;
      }
      if (updated.id !== snap.targetId) this.forkedIds.set(snap.targetId, updated.id);
      if (this.targetConfigId === snap.targetId) {
        this.targetConfigId = updated.id;
        this.savedPathsState.set(new Set(snap.entries.map((e) => e.portName)));
      }
      // The share popover snapshots the page's active config — hand it the
      // config that was just written, not the one loaded at page open.
      this.src.onSaved(updated);
      return { updated, previous };
    } catch (error) {
      logWarn('codex', 'loadout save failed', error);
      this.saveErrorState.set(this.t.instant(toErrorKey('codex', 'saveLoadout', error)) as string);
      return null;
    } finally {
      this.savingState.set(false);
    }
  }

  // ── autosave on an own exemplar (concept holotisch-feinschliff D3) ──────

  /**
   * On: the table shows the reader's OWN exemplar (the page decides — not
   * Werk, not a shared read-only link, not a followed config) and every swap /
   * revert is written by itself, debounced so a burst of swaps is one save,
   * confirmed by ONE undo toast. Off (Werk, the sandbox): nothing saves unless
   * the reader asks.
   */
  setAutosave(on: boolean): void {
    if (this.autosaveOnState() === on) return;
    if (!on) this.flushAutosave();
    this.autosaveOnState.set(on);
  }

  /** A swap / revert happened: (re)arm the debounce, remember which paths changed. */
  private scheduleAutosave(paths: readonly string[]): void {
    if (!this.autosaveOnState() || this.readOnly() || !this.targetConfigId || paths.length === 0) return;
    for (const p of paths) this.autosavePaths.add(p);
    this.cancelAutosaveTimer();
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.startAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  /** A pending autosave is written NOW (new loadout on the table, page left) — with the draft as it is at this moment. */
  flushAutosave(): void {
    if (this.autosaveTimer === null) return;
    this.cancelAutosaveTimer();
    this.startAutosave();
  }

  private cancelAutosaveTimer(): void {
    if (this.autosaveTimer !== null) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  private startAutosave(): void {
    const changed = this.autosavePaths.size;
    const snap = this.snapshot([...this.autosavePaths]);
    this.autosavePaths.clear();
    if (snap && changed > 0) void this.runAutosave(snap, changed);
  }

  private async runAutosave(snap: SaveSnapshot, changed: number): Promise<void> {
    // One toast for a run of saves: while the last one is still showing, its
    // count grows and its undo goes back to the loadout before the FIRST save.
    const live = this.autosaveToast;
    const result = await this.saveSnapshot(snap);
    if (!result) return; // saveError carries the failure — the save bar shows it
    const n = (live?.n ?? 0) + changed;
    const toast = { n, restore: live?.restore ?? result.previous };
    this.autosaveToast = toast;
    this.undoToast.offer({
      messageKey: n === 1 ? 'codex.holo.hangar.autosavedOne' : 'codex.holo.hangar.autosavedMany',
      messageParams: { n },
      commit: () => {
        if (this.autosaveToast === toast) this.autosaveToast = null;
      },
      onUndo: () => {
        if (this.autosaveToast === toast) this.autosaveToast = null;
        void this.undoAutosave(result.updated.id, toast.restore);
      },
    });
  }

  /** "Rückgängig" on the autosave toast: the config gets its earlier loadout back and the table shows it. */
  private undoAutosave(configId: string, loadout: ConfigLoadoutEntry[]): Promise<void> {
    this.cancelAutosaveTimer();
    this.autosavePaths.clear();
    return this.serialWrite(() => this.writeUndo(configId, loadout));
  }

  private async writeUndo(configId: string, loadout: ConfigLoadoutEntry[]): Promise<void> {
    this.savingState.set(true);
    this.saveErrorState.set(null);
    try {
      const back = await this.hangar.updateConfig(configId, { loadout });
      if (!back) {
        this.saveErrorState.set(this.t.instant(this.hangar.error?.() ?? 'codex.loadout.saveErrorGeneric') as string);
        return;
      }
      this.src.onSaved(back);
      if (this.targetConfigId === configId) this.applyStoredLoadout(back.loadout, { configId });
    } catch (error) {
      logWarn('codex', 'autosave undo failed', error);
      this.saveErrorState.set(this.t.instant(toErrorKey('codex', 'undoAutosave', error)) as string);
    } finally {
      this.savingState.set(false);
    }
  }

  /**
   * The draft as a stored loadout of its own (D1: "Auf die Wunschliste" from a
   * swapped Werk keeps the swaps): the saveable entries, top-level and nested.
   */
  draftAsLoadout(): ConfigLoadoutEntry[] {
    if (this.readOnly()) return [];
    return mergeSavedLoadout([], this.saveableEntries(), touchedSavePaths(this.draftState(), this.src.joinablePorts()));
  }

  ngOnDestroy(): void {
    // Leaving the page inside the debounce window still writes the last swaps.
    this.flushAutosave();
  }

  /**
   * "In dein HQ übernehmen" (codex mode): put the ship into the hangar when it
   * is not there yet and create a NEW variant carrying the current draft (the
   * stock loadout when nothing changed). Resolves the new config — the page
   * then opens it as `?v=<id>` — or null when anything was refused.
   */
  adoptToHq(): Promise<HangarShipConfig | null> {
    // One write per click burst: a second call while the first is in flight joins it instead of
    // creating a second "Codex-Loadout" (round-7 E8 — the name dialog's AI wait looked like nothing happened).
    this.adoptInFlight ??= this.runAdoptToHq().finally(() => {
      this.adoptInFlight = null;
    });
    return this.adoptInFlight;
  }

  private adoptInFlight: Promise<HangarShipConfig | null> | null = null;

  private async runAdoptToHq(): Promise<HangarShipConfig | null> {
    const d = this.src.detail();
    if (d?.kind !== 'ship') return null;
    this.savingState.set(true);
    this.saveErrorState.set(null);
    try {
      const ship =
        this.hangar.shipByClassName(d.classNameSlug) ?? (await this.hangar.addShip(d.classNameSlug, 'owned'));
      if (!ship) {
        this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
        return null;
      }
      const touched = touchedSavePaths(this.draftState(), this.src.joinablePorts());
      const loadout = this.readOnly() ? [] : mergeSavedLoadout([], this.saveableEntries(), touched);
      const created = await this.hangar.createConfig(
        ship.id,
        this.t.instant('codex.loadout.defaultConfigName') as string,
        'multipurpose',
        loadout,
      );
      if (!created) {
        this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
        return null;
      }
      this.src.onSaved(created);
      return created;
    } catch (error) {
      logWarn('codex', 'adopt to HQ failed', error);
      this.saveErrorState.set(this.t.instant('codex.loadout.saveErrorGeneric') as string);
      return null;
    } finally {
      this.savingState.set(false);
    }
  }

  discardLoadoutDraft(): void {
    // Discarding drops the pending swaps too — they were never meant to be kept.
    this.cancelAutosaveTimer();
    this.autosavePaths.clear();
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
    this.applyRestored(entries, sourceBuildId, buildId);
    // A draft that came back from localStorage is mirrored into the url so
    // "Link kopieren" carries what the table shows (wave 5 A1.2).
    if (!fromUrl) this.persistDraftMirror();
  }

  /**
   * Put a named loadout the reader saved locally (#322, SavedLoadoutsService)
   * back on the table. Same rules as a restored draft: the build is checked,
   * slots whose class no longer resolves are flagged, and the result is an
   * UNSAVED draft mirrored into URL + localStorage. Refused on a read-only
   * (shared) draft. Returns false when nothing could be applied.
   */
  applySavedDraft(entries: readonly [string, string | null][], sourceBuildId: string): boolean {
    const buildId = this.svc.build()?.id;
    if (!buildId || this.readOnly() || entries.length === 0) return false;
    this.flushAutosave();
    this.saveErrorState.set(null);
    this.savedPathsState.set(new Set());
    // Saved against THIS build, every class was picked from it: hydrate them
    // all (the swap picker's classes are not in the page's loadout entities).
    this.applyRestored([...entries], sourceBuildId, buildId, sourceBuildId === buildId);
    this.persistDraftMirror();
    return true;
  }

  private applyRestored(
    entries: [string, string | null][],
    sourceBuildId: string,
    buildId: string,
    trustClasses = false,
  ): void {
    const classResolves = (className: string): boolean =>
      trustClasses || this.src.loadoutEntities().has(className) || stockLoadoutClassNames(
        (this.src.detail()?.payload as ShipPayload | undefined)?.defaultLoadout ?? [],
      ).includes(className);
    const restored = restoreDraft({ version: 'v1', buildId: sourceBuildId, entries }, buildId, classResolves);
    this.draftState.set(restored.draft);
    this.unresolvableState.set(new Set(restored.unresolvable));
    // A restored draft is UNSAVED by definition (R8) — savedPaths stays empty.
    for (const [path, value] of restored.draft) {
      if (value && !restored.unresolvable.includes(path)) void this.hydrateDraftClass(value);
    }
  }
}
