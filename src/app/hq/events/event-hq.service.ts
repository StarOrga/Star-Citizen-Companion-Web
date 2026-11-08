import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { NewsService } from '../../news/news.service';
import { computeNextPatch } from '../../news/patch-stats';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqLiveService } from '../now/hq-live.service';
import { isGameLive } from '../now/hq-live.util';
import { NachschubService } from '../nachschub/nachschub.service';
import { isEventNachschub, abortEventNachschub, claimPlan, resumeEventNachschub, type ClaimChannel } from './event-nachschub';
import { nearestEndOf, readPlaceReport, eventOffer, type EventOffer } from './event-hq.util';
import { openEvents, type OpenEvent, type ResolvedEnd, resolveEventEnd, type EventRow } from './event-logic';
import { EventSheetService } from './event-sheet.service';
import { UserEventStateService } from './user-event-state.service';
import type { EventReward } from './event-sheet';
import type { Nachschub } from '../nachschub/nachschub.model';

/** Where claimed event rewards land in Inventar (ships go to the Hangar instead). */
export const EVENT_REWARD_LOCATION = 'Event-Belohnungen';
const LIVE_POLL_MS = 30_000;

/**
 * Facade of the HQ event surfaces: which events are open for this reader (slot "+" teaser, Start marker, "Neuer
 * Nachschub"), the event Nachschub lifecycle (abort, resume, archive at the end, complete) and the claim (state + Bestand).
 * Rules are pure in `event-logic.ts` / `event-nachschub.ts` / `event-hq.util.ts`.
 */
@Injectable({ providedIn: 'root' })
export class EventHqService {
  private readonly auth = inject(AuthService);
  private readonly sheets = inject(EventSheetService);
  private readonly states = inject(UserEventStateService);
  private readonly news = inject(NewsService);
  private readonly ns = inject(NachschubService);
  private readonly einsatz = inject(HqEinsatzService);
  private readonly inventory = inject(HqInventoryService);
  private readonly hangar = inject(HangarService);
  private readonly live = inject(HqLiveService);

  private readonly now = signal(Date.now());
  private ensured: string | null = null;
  private readonly endsReady = signal(false);
  private endsApplied = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // Archive at the end of every bound event - only once the Einsaetze are loaded, so the event steps are known.
    effect(() => {
      if (!this.endsReady() || !this.einsatz.ready() || this.endsApplied) return;
      this.endsApplied = true;
      untracked(() => void this.ns.applyEventEnds(this.ends(), Date.now(), (n) => this.eventIdsOf(n)));
    });
  }

  /** i18n key of the last failed load, else null. */
  readonly error = computed(() => this.sheets.error() ?? this.states.error());
  readonly loaded = computed(() => this.sheets.loaded() && this.states.loaded());

  /** Estimated next main patch (ISO) from the same estimate the news page uses; null = no date. */
  readonly nextPatchIso = computed(() => computeNextPatch(this.news.patchLines())?.atIso ?? null);

  /** Running events that are neither done nor dismissed, nearest end first. */
  readonly open = computed<readonly OpenEvent[]>(() => openEvents(this.sheets.events(), this.states.states(), this.nextPatchIso(), this.now()));
  readonly hasOpen = computed(() => this.open().length > 0);
  readonly nearest = computed(() => nearestEndOf(this.open()));
  readonly done = this.states.done;
  readonly events = this.sheets.events;
  readonly byId = this.sheets.byId;

  /** End of every known event (C5), for the archive-at-end pass. */
  readonly ends = computed<ReadonlyMap<string, ResolvedEnd>>(
    () => new Map(this.sheets.events().map((e) => [e.id, resolveEventEnd(e, this.nextPatchIso())] as const)),
  );

  /** Loads sheets and states once per signed-in user, then archives event Nachschuebe whose official end has passed. */
  ensure(): void {
    const uid = this.auth.user()?.id ?? null;
    if (!uid || this.ensured === uid) return;
    this.ensured = uid;
    this.now.set(Date.now());
    void Promise.all([this.sheets.load(), this.states.load(), this.ns.ensureLoaded()]).then(() => this.endsReady.set(true));
  }

  eventById(id: string | null | undefined): EventRow | null {
    return id ? (this.sheets.byId().get(id) ?? null) : null;
  }

  stateOf = (id: string) => this.states.stateOf(id);
  readonly doneEvents = computed(() => this.states.done().map((s) => ({ state: s, event: this.sheets.byId().get(s.eventId) ?? null })));

  /** Event ids a Nachschub covers: its own binding plus every event step of its Einsaetze (several are allowed). */
  eventIdsOf(n: Pick<Nachschub, 'id' | 'eventId'>): readonly string[] {
    const ids = new Set<string>(n.eventId ? [n.eventId] : []);
    for (const e of this.einsatz.ofPackage(n.id)) for (const s of e.steps) if (s.eventId) ids.add(s.eventId);
    return [...ids];
  }

  // ------------------------------------------------------------------------------------------------ progress

  setProgress(eventId: string, trackId: string, value: number): Promise<boolean> {
    return this.states.setTrackProgress(eventId, trackId, value, 'manual');
  }

  /** While the SCC-App is connected the state is re-read every 30 s so live progress shows up without a reload. */
  startLive(destroyRef: DestroyRef): void {
    this.stopLive();
    this.pollTimer = setInterval(() => {
      if (this.gameLive()) void this.states.load();
    }, LIVE_POLL_MS);
    destroyRef.onDestroy(() => this.stopLive());
  }
  private stopLive(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }
  /** The SCC-App reports a running game right now (fresh life sign, no session end after it). */
  private gameLive(): boolean {
    return isGameLive(this.live.state(), this.live.events(), Date.now());
  }
  readonly appConnected = computed(() => this.live.state() !== null);

  // ------------------------------------------------------------------------------------------------ lifecycle

  /** Abort: the slot frees, progress stays, nothing returns to the wishlist; resumable any time (C9). */
  async abort(n: Nachschub): Promise<boolean> {
    if (!isEventNachschub(n) || !n.eventId) return false;
    const r = abortEventNachschub(n, new Date().toISOString());
    const ok = await this.ns.update(r.nachschub);
    if (ok) await this.states.setStatus(n.eventId, r.eventStatus);
    return ok;
  }

  async resume(id: string): Promise<boolean> {
    const r = resumeEventNachschub(this.ns.packages(), id);
    if (!r) return false;
    const ok = await this.ns.update(r.nachschub);
    if (ok && r.nachschub.eventId) await this.states.setStatus(r.nachschub.eventId, r.eventStatus);
    return ok;
  }

  /** The whole event ticked "erledigt": state done (feeds Statistik) and every Nachschub of it archives. */
  async complete(eventId: string): Promise<boolean> {
    const ok = await this.states.setStatus(eventId, 'done');
    if (!ok) return false;
    const at = new Date().toISOString();
    for (const n of this.ns.active()) {
      if (isEventNachschub(n) && this.eventIdsOf(n).includes(eventId) && this.eventIdsOf(n).every((id) => this.states.stateOf(id).status === 'done')) await this.ns.update({ ...n, status: 'archived', slot: null, archivedAt: at });
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------------ claim (C10)

  /**
   * Claims a reward: records it in the event state and, when `store`, puts it into Bestand with the origin of the
   * channel (ships -> Hangar, everything else -> Inventar location "Event-Belohnungen"). The exact wished class
   * shrinks on the wishlist - never the base item (C11).
   */
  async claim(eventId: string, reward: EventReward, channel: ClaimChannel, store: boolean, ship: boolean): Promise<boolean> {
    const saved = await this.states.claim(eventId, reward.id, channel, store);
    if (!saved || !store || !reward.className) return saved;
    const plan = claimPlan(channel, ship);
    for (const g of plan.grants) {
      if (g.destination === 'hangar') await this.grantShip(reward.className, g.origin);
      else await this.inventory.addStock(EVENT_REWARD_LOCATION, reward.name, 1, 'pcs', reward.className, g.origin);
    }
    await this.ns.fulfilEventReward(reward, plan.grants.length);
    return true;
  }

  private async grantShip(className: string, origin: 'pledge' | 'ingame'): Promise<void> {
    const have = this.hangar.shipByClassName(className);
    if (!have) {
      const added = await this.hangar.addShip(className, 'owned');
      if (added) await this.hangar.updateShip(added.id, { origin });
      return;
    }
    if (have.status !== 'owned') await this.hangar.updateShip(have.id, { status: 'owned', origin });
    else await this.hangar.updateShip(have.id, { qty: (have.qty ?? 1) + 1, origin });
  }

  // ------------------------------------------------------------------------------------------------ Jetzt offer (F9)

  /** The live offer for the focused Nachschub (see {@link eventOffer}); `dismissedKey` is the place the reader waved off. */
  offer(dismissedKey: string | null, focusedId: string | null, nowMs: number = Date.now()): EventOffer | null {
    const state = this.live.state();
    return eventOffer(this.ns.active(), this.open(), readPlaceReport(state), isGameLive(state, this.live.events(), nowMs), dismissedKey, focusedId);
  }
  placeKey(): string {
    return readPlaceReport(this.live.state()).key;
  }
}
