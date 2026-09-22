/**
 * Builds the single plan object a run is started from — manual (Start button)
 * and unattended (`maybeAutoRun`) both go through this, so `startRun(plan)`
 * never has to branch on who triggered it.
 *
 * Pure by design: no Electron, no I/O. See `src/lib/settings-store.ts` for the
 * persisted defaults and `src/lib/auto-run.ts` for the unattended decision
 * this consumes.
 */

import type { ChannelTag } from './discovery.js';
import type { Settings } from './settings-store.js';

/** Per-run "when done" choice. Manual runs pick this live; never persisted. */
export type WhenDone = 'nothing' | 'quit' | 'shutdown';

export interface RunPlan {
  channel: ChannelTag;
  scope: Settings['extractScope'];
  /** Only ever true when the operator is signed in. */
  uploadAfter: boolean;
  whenDone: WhenDone;
  /** True for a run started hidden/unattended (the `--hidden` login item). */
  unattended: boolean;
}

/** Maps the persisted `afterAutoRun` app setting onto the per-run `WhenDone` shape. */
function mapAfterAutoRun(value: Settings['afterAutoRun']): WhenDone {
  switch (value) {
    case 'keep':
      return 'nothing';
    case 'quit':
      return 'quit';
    case 'shutdown':
      return 'shutdown';
  }
}

interface ManualRunInput {
  unattended?: false;
  /** Game version/channel picked on the launch pad. */
  channel: ChannelTag;
  settings: Settings;
  signedIn: boolean;
  /** The operator's live "when done" pick for this run. */
  whenDone: WhenDone;
}

interface UnattendedRunInput {
  unattended: true;
  /** The channel `decideAutoRun` picked. */
  channel: ChannelTag;
  settings: Settings;
  signedIn: boolean;
}

export type BuildRunPlanInput = ManualRunInput | UnattendedRunInput;

/**
 * Build the plan a run executes from. Scope always comes from settings; the
 * two triggers differ only in `whenDone`:
 *
 * - Manual run (Start button): `whenDone` is the live per-run pick.
 * - Unattended run (`maybeAutoRun`): `whenDone` derives from
 *   `settings.afterAutoRun`.
 *
 * A successful extraction always continues into the upload when signed in —
 * there is no "extract only" mode. Not signed in, there is nothing to upload to.
 */
export function buildRunPlan(input: BuildRunPlanInput): RunPlan {
  if (input.unattended) {
    return {
      channel: input.channel,
      scope: input.settings.extractScope,
      uploadAfter: input.signedIn,
      whenDone: mapAfterAutoRun(input.settings.afterAutoRun),
      unattended: true,
    };
  }
  return {
    channel: input.channel,
    scope: input.settings.extractScope,
    uploadAfter: input.signedIn,
    whenDone: input.whenDone,
    unattended: false,
  };
}
