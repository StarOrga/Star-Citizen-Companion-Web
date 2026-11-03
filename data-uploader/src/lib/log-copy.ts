/**
 * Copy the log transcript and say what happened: copied, failed, or empty. An
 * empty log (after an app restart the in-memory transcript is gone) is reported
 * as such and never written - it would silently wipe the user's clipboard.
 */

export type CopyOutcome = 'copied' | 'failed' | 'empty';

export async function copyTranscript(
  text: string,
  write: (text: string) => Promise<{ ok?: boolean } | void>,
): Promise<CopyOutcome> {
  if (!text.trim()) return 'empty';
  try {
    const r = await write(text);
    return r && r.ok === false ? 'failed' : 'copied';
  } catch {
    return 'failed';
  }
}

export const COPY_OUTCOME_KEY: Record<CopyOutcome, string> = {
  copied: 'run.copied',
  failed: 'run.copyFailed',
  empty: 'run.copyEmpty',
};
