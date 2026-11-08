import {
  Nachschub,
  OpenLine,
  WishPosition,
  archive,
  clearNachschub,
  freeSlot,
  fulfilWish,
  reactivate,
  type ClearResult,
  type NachschubType,
} from '../nachschub/nachschub.model';
import { endMs, type ClaimedReward, type ResolvedEnd, type UserEventState, type UserEventStatus } from './event-logic';
import type { EventReward } from './event-sheet';

/*
 * Event Nachschub rules (C8-C12): a Nachschub of type event / sightseeing is a normal slot that is bound to an event.
 * Pure; the services persist the results.
 */

export const isEventNachschub = (n: Pick<Nachschub, 'type'>): boolean => n.type === 'event' || n.type === 'sightseeing';

/** A reward-less event becomes a sightseeing Nachschub, otherwise an event Nachschub (ev-a3). */
export function nachschubTypeFor(rewards: readonly EventReward[] | null): NachschubType {
  return rewards && rewards.length ? 'event' : 'sightseeing';
}

// ------------------------------------------------------------------------------------------------ abort / resume (C9)

export interface AbortResult {
  readonly nachschub: Nachschub;
  /** Event status to persist in user_event_state. Progress is untouched. */
  readonly eventStatus: UserEventStatus;
  /** Lines stay where they are (progress is kept); NOTHING goes back to the wishlist. */
  readonly removeLineIds: readonly string[];
  readonly wishlistReturn: readonly never[];
}

/** Abort: frees the slot (archived), keeps lines + progress, nothing returns to the wishlist, resumable any time. */
export function abortEventNachschub(n: Nachschub, at: string): AbortResult {
  return { nachschub: archive(n, at), eventStatus: 'aborted', removeLineIds: [], wishlistReturn: [] };
}

/** "Leeren" on an event Nachschub: open lines leave but are NEVER put back on the wishlist (any `backToWishlist`). */
export function clearEventNachschub(lines: readonly OpenLine[], wish: readonly WishPosition[]): ClearResult {
  return clearNachschub(lines, wish, false);
}

/** Resume an aborted / archived event Nachschub when a slot is free; null otherwise. */
export function resumeEventNachschub(all: readonly Nachschub[], id: string): { nachschub: Nachschub; eventStatus: UserEventStatus } | null {
  const n = all.find((x) => x.id === id);
  if (!n || !isEventNachschub(n) || freeSlot(all) === null) return null;
  const back = reactivate(all, id);
  return back ? { nachschub: back, eventStatus: 'open' } : null;
}

// ------------------------------------------------------------------------------------------------ archive at end (C12)

/** An event Nachschub archives itself once the OFFICIAL end has passed. Estimates never archive. */
export function archiveAtEventEnd(all: readonly Nachschub[], ends: ReadonlyMap<string, ResolvedEnd>, nowMs: number, at: string): readonly Nachschub[] {
  return all.map((n) => {
    if (n.status !== 'active' || !isEventNachschub(n) || !n.eventId) return n;
    const end = ends.get(n.eventId);
    const t = end ? endMs(end) : null;
    return end && end.basis === 'official' && t !== null && t < nowMs ? archive(n, at) : n;
  });
}

export type RewardLineState = 'open' | 'waiting' | 'claimed';

/**
 * State of a reward line: `claimed` once ticked; `waiting` („wartet auf Verteilung“) for timing after-end - until the
 * reader ticks it, also after the event ended; everything else is `open`.
 */
export function rewardLineState(reward: EventReward, claimed: Readonly<Record<string, ClaimedReward>>): RewardLineState {
  if (claimed[reward.id]) return 'claimed';
  return reward.timing.kind === 'after-end' ? 'waiting' : 'open';
}

// ------------------------------------------------------------------------------------------------ claim (C10)

export type ClaimChannel = 'pledge' | 'ingame' | 'both';
export type ClaimDestination = 'hangar' | 'inventory';
export interface StockGrant {
  readonly origin: 'pledge' | 'ingame';
  readonly destination: ClaimDestination;
}
export interface ClaimPlan {
  readonly channel: ClaimChannel;
  /** What goes into Bestand: ships -> Hangar, everything else -> Inventar; origin pledge or ingame. `both` = two grants. */
  readonly grants: readonly StockGrant[];
}

/** Preselected claim channel from the sheet; unknown -> ingame (the safe default). */
export function defaultClaimChannel(reward: Pick<EventReward, 'channel'>): ClaimChannel {
  return reward.channel === 'pledge' || reward.channel === 'both' || reward.channel === 'ingame' ? reward.channel : 'ingame';
}

export function claimPlan(channel: ClaimChannel, isShip: boolean): ClaimPlan {
  const destination: ClaimDestination = isShip ? 'hangar' : 'inventory';
  const origins: ('pledge' | 'ingame')[] = channel === 'both' ? ['pledge', 'ingame'] : [channel];
  return { channel, grants: origins.map((origin) => ({ origin, destination })) };
}

/** Records a claim in the user state (store = put into Bestand). The channel can be changed later by the SCC-App (`by: 'live'`). */
export function claimReward(state: UserEventState, rewardId: string, channel: ClaimChannel, store: boolean, at: string, by: 'user' | 'live' = 'user'): UserEventState {
  return { ...state, claimed: { ...state.claimed, [rewardId]: { channel, at, stored: store, by } }, updatedAt: at };
}

/** Whole event ticked „erledigt“ (done feeds Statistik). */
export function completeEvent(state: UserEventState, at: string): UserEventState {
  return { ...state, status: 'done', updatedAt: at };
}

// ------------------------------------------------------------------------------------------------ wishlist dedupe (C11)

/** Does this wish IS the event reward? Only the exact reward class_name matches; never the base item or a sibling. */
export function isRewardWish(wish: Pick<WishPosition, 'className' | 'forClassName'>, reward: Pick<EventReward, 'className'>): boolean {
  const rc = (reward.className ?? '').trim().toLowerCase();
  if (!rc) return false;
  return wish.className.trim().toLowerCase() === rc && !(wish.forClassName ?? '').trim();
}

/** The wish positions that the reward satisfies (exact class only). */
export function rewardWishes(wish: readonly WishPosition[], reward: Pick<EventReward, 'className'>): readonly WishPosition[] {
  return wish.filter((w) => isRewardWish(w, reward));
}

/** After the reward is claimed, only the exact wished class shrinks (fulfilWish); everything else is untouched. */
export function wishlistAfterClaim(wish: readonly WishPosition[], reward: Pick<EventReward, 'className'>, gained = 1): readonly WishPosition[] {
  return wish.flatMap((w) => {
    if (!isRewardWish(w, reward)) return [w];
    const { qty } = fulfilWish(w.qty, gained);
    return qty > 0 ? [{ ...w, qty }] : [];
  });
}

