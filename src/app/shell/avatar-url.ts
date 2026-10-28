import type { User } from '@supabase/supabase-js';

/** Providers whose picture wins, in this order; any other linked provider follows. */
const PROVIDER_ORDER = ['discord', 'google'] as const;

function pictureOf(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  for (const key of ['avatar_url', 'picture']) {
    const v = data[key];
    if (typeof v === 'string' && /^https:\/\//i.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * The account's profile picture for the avatar button: the Discord identity's
 * avatar first, then Google, then any other linked OAuth identity, then the
 * merged `user_metadata` (Supabase copies the last sign-in's picture there).
 * Only https URLs count. Null → the caller shows the initial.
 */
export function avatarUrlOf(user: Pick<User, 'identities' | 'user_metadata'> | null | undefined): string | null {
  if (!user) return null;
  const identities = user.identities ?? [];
  const rank = (provider: string): number => {
    const i = (PROVIDER_ORDER as readonly string[]).indexOf(provider);
    return i === -1 ? PROVIDER_ORDER.length : i;
  };
  const sorted = [...identities].sort((a, b) => rank(a.provider) - rank(b.provider));
  for (const identity of sorted) {
    const url = pictureOf(identity.identity_data as Record<string, unknown> | undefined);
    if (url) return url;
  }
  return pictureOf(user.user_metadata as Record<string, unknown> | undefined);
}
