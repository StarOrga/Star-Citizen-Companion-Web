/**
 * Auto-run decision — "is the local data.p4k newer than what the site already
 * has, and should we therefore run the whole pipeline unattended?"
 *
 * Pure by design: this is the one piece that decides whether the tool starts a
 * multi-hour extraction + upload with nobody watching, so it must be testable
 * without Electron, a game install, or a network.
 *
 * The comparison is deliberately conservative — **only a confident "the local
 * build differs from the uploaded one" starts a run.** Anything ambiguous
 * (unreadable local version, no session, no server snapshot) resolves to "do
 * nothing". Wrongly skipping costs one manual click; wrongly starting burns
 * hours of CPU and re-uploads a build the server already has.
 */

import type { ChannelTag, DiscoveredChannel } from './discovery.js';
import type { CatalogSnapshot } from './sync.js';

export type SkipReason =
  | 'disabled'
  | 'no-session'
  | 'no-snapshot'
  | 'no-channels'
  | 'unknown-local-version'
  | 'already-uploaded';

export interface AutoRunDecision {
  run: boolean;
  /** The channel to process — only set when `run` is true. */
  channel?: DiscoveredChannel;
  /** Local version that differs from the server's. */
  localVersion?: string;
  /** What the server currently holds for that channel (null = nothing yet). */
  serverVersion?: string | null;
  reason?: SkipReason;
}

export interface AutoRunInputs {
  enabled: boolean;
  signedIn: boolean;
  channels: DiscoveredChannel[];
  snapshot: CatalogSnapshot | null;
}

/** Channels are ranked so an unattended run picks the one that matters most. */
const CHANNEL_PRIORITY: readonly ChannelTag[] = ['LIVE', 'PTU', 'EPTU', 'TECH-PREVIEW'];

/** The server tags channels lowercase (`live`); discovery uses uppercase. */
function serverVersionFor(snapshot: CatalogSnapshot, channel: ChannelTag): string | null {
  const tag = channel.toLowerCase();
  const hit = snapshot.channels.find((c) => c.channel.toLowerCase() === tag);
  return hit ? hit.patchVersion : null;
}

export function decideAutoRun(input: AutoRunInputs): AutoRunDecision {
  if (!input.enabled) return { run: false, reason: 'disabled' };
  // An unattended run must never pop a browser login — that would leave the
  // machine sitting on an OAuth page instead of uploading.
  if (!input.signedIn) return { run: false, reason: 'no-session' };
  if (!input.channels.length) return { run: false, reason: 'no-channels' };
  // Without a snapshot we cannot know what is already uploaded. Running anyway
  // would re-extract + re-upload the current build on every single launch.
  if (!input.snapshot) return { run: false, reason: 'no-snapshot' };

  const ordered = [...input.channels].sort(
    (a, b) => CHANNEL_PRIORITY.indexOf(a.channel) - CHANNEL_PRIORITY.indexOf(b.channel),
  );

  let sawUnknown = false;
  for (const channel of ordered) {
    if (!channel.version) {
      // Version file missing/unparseable — we cannot prove it is new, so we
      // must not act on it. Keep looking; a later channel may be decidable.
      sawUnknown = true;
      continue;
    }
    const serverVersion = serverVersionFor(input.snapshot, channel.channel);
    if (serverVersion !== channel.version) {
      return {
        run: true,
        channel,
        localVersion: channel.version,
        serverVersion,
      };
    }
  }

  return { run: false, reason: sawUnknown ? 'unknown-local-version' : 'already-uploaded' };
}

/** One-line log/UI summary of a decision. */
export function describeDecision(d: AutoRunDecision): string {
  if (d.run && d.channel) {
    return `${d.channel.channel}: local ${d.localVersion} vs server ${d.serverVersion ?? 'none'} — starting`;
  }
  return `no auto-run (${d.reason})`;
}

/**
 * Should an unattended launch close itself again?
 *
 * The operator asked for an autostart that does not leave a tray icon behind
 * when there was nothing to do (feedback 71b1e402). "Nothing to do" is a
 * narrower claim than "we did not start a run": of the six skip reasons, only
 * `already-uploaded` is the tool saying *the server already has this build*.
 * The others mean it could not tell (`no-snapshot`, `unknown-local-version`,
 * `no-channels`), was not allowed to (`no-session`), or was never asked
 * (`disabled`) — quitting on those would hide a problem behind a process that
 * silently vanishes at every login.
 *
 * Foreground starts are never affected: the operator opened the window, so the
 * window stays.
 */
export function shouldQuitAfterAutoRun(input: {
  /** Launched by the login item with `--hidden`, i.e. nobody is watching. */
  startedHidden: boolean;
  /** The `quitAfterAutoRun` preference. */
  enabled: boolean;
  /** Why the auto-run decided not to run. */
  reason?: SkipReason;
}): boolean {
  if (!input.startedHidden || !input.enabled) return false;
  return input.reason === 'already-uploaded';
}
