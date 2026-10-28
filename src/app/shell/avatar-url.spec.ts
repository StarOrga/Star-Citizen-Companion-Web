import type { User, UserIdentity } from '@supabase/supabase-js';
import { avatarUrlOf } from './avatar-url';

function identity(provider: string, data: Record<string, unknown>): UserIdentity {
  return { provider, identity_data: data } as unknown as UserIdentity;
}

function user(identities: UserIdentity[], meta: Record<string, unknown> = {}): Pick<User, 'identities' | 'user_metadata'> {
  return { identities, user_metadata: meta };
}

describe('avatarUrlOf', () => {
  it('prefers the Discord avatar over Google, whatever the link order', () => {
    const u = user([
      identity('google', { picture: 'https://lh3.googleusercontent.com/a/g' }),
      identity('discord', { avatar_url: 'https://cdn.discordapp.com/avatars/1/d.png' }),
    ]);
    expect(avatarUrlOf(u)).toBe('https://cdn.discordapp.com/avatars/1/d.png');
  });

  it('falls back to another linked provider, then to user_metadata', () => {
    expect(avatarUrlOf(user([identity('discord', {}), identity('github', { avatar_url: 'https://avatars.example.com/x' })]))).toBe(
      'https://avatars.example.com/x',
    );
    expect(avatarUrlOf(user([identity('email', {})], { picture: 'https://example.com/p.png' }))).toBe('https://example.com/p.png');
  });

  it('returns null without a usable https picture (the initial shows)', () => {
    expect(avatarUrlOf(null)).toBeNull();
    expect(avatarUrlOf(user([identity('discord', { avatar_url: 'http://insecure.example.com/a.png' })]))).toBeNull();
    expect(avatarUrlOf(user([], { avatar_url: 42 }))).toBeNull();
  });
});
