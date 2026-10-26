// Pure mapping of handoff_revoke()'s outcome to an HTTP answer.
// `revoked: true` only when a row actually changed.
export type RevokeOutcome = 'revoked' | 'pending' | 'burned' | 'already' | 'none';

export function revokeResponse(outcome: unknown): { status: number; body: Record<string, unknown> } {
  switch (outcome) {
    case 'revoked':
    case 'pending':
    case 'burned':
      return { status: 200, body: { revoked: true, outcome } };
    case 'already':
      return { status: 200, body: { revoked: false, outcome } };
    case 'none':
      return { status: 404, body: { error: 'not_found' } };
    default:
      return { status: 500, body: { error: 'server_error' } };
  }
}

/** The SQL function raises 'revoke_unavailable' (42501) where auth.sessions DELETE is not granted. */
export function isRevokeUnavailable(err: { message?: string; code?: string } | null | undefined): boolean {
  return !!err && (err.code === '42501' || (err.message ?? '').includes('revoke_unavailable'));
}
