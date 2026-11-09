// Finalize step: record "first appeared in patch X" and "changed in patch X" for
// the build (RPC codex_record_patch_news, migration 20261108220000). Never fatal:
// a project without the migration, or any failure, only leaves the Codex news on
// its old two-build diff — the catalog run itself must still finalize.

export type PatchNewsRpc = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;

export type PatchNewsResult =
  | { status: 'recorded'; detail: unknown }
  | { status: 'degraded'; reason: 'no_patch_news' }
  | { status: 'failed'; message: string };

function isMissingFunction(e: { message?: string; code?: string }): boolean {
  const msg = (e.message ?? '').toLowerCase();
  return e.code === 'PGRST202' || e.code === '42883' || msg.includes('could not find the function') ||
    msg.includes('does not exist');
}

export async function recordPatchNews(rpc: PatchNewsRpc, buildId: string): Promise<PatchNewsResult> {
  try {
    const { data, error } = await rpc('codex_record_patch_news', { p_build_id: buildId });
    if (!error) return { status: 'recorded', detail: data };
    if (isMissingFunction(error)) return { status: 'degraded', reason: 'no_patch_news' };
    return { status: 'failed', message: error.message ?? 'rpc error' };
  } catch (e) {
    return { status: 'failed', message: (e as Error).message };
  }
}
