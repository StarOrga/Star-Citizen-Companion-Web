/**
 * What kind of Supabase auth e-mail link the app was opened with.
 *
 * WHY THIS EXISTS AT ALL
 * An invite mail sends the applicant to `…/auth/v1/verify?type=invite&…`,
 * which bounces to the site with the tokens in the URL *fragment*
 * (`#access_token=…&type=invite`). `supabase-js` consumes that fragment
 * during `detectSessionInUrl` and STRIPS it from the address bar, so by the
 * time any component could look, the only trace that this visit began with an
 * invite is gone — and the user is sitting in the app, signed in, with no
 * password and nothing telling them so.
 *
 * `supabase-js` re-announces `type=recovery` as its own `PASSWORD_RECOVERY`
 * event, but `type=invite` arrives as a plain `SIGNED_IN` that is
 * indistinguishable from a normal returning visit. Hence this snapshot: read
 * the URL once, at module load, BEFORE the Supabase client is ever
 * constructed (clients are created on first injection, i.e. after bootstrap),
 * and keep the answer.
 */
export type AuthLinkType = 'invite' | 'recovery' | null;

/** The `type` values worth reacting to; anything else is not our business. */
const KNOWN = new Set<string>(['invite', 'recovery']);

/**
 * Parse the link type out of a full URL. Both the fragment (implicit grant,
 * which is what admin-generated invite and recovery mails produce) and the
 * query string are checked — the latter costs nothing and covers a project
 * configured to hand back `?type=` instead.
 */
export function readAuthLinkType(href: string): AuthLinkType {
  const hashIndex = href.indexOf('#');
  const fragment = hashIndex === -1 ? '' : href.slice(hashIndex + 1);
  const queryIndex = href.indexOf('?');
  const query =
    queryIndex === -1 || (hashIndex !== -1 && queryIndex > hashIndex)
      ? ''
      : href.slice(queryIndex + 1, hashIndex === -1 ? undefined : hashIndex);

  for (const part of [fragment, query]) {
    if (!part) continue;
    let type: string | null = null;
    try {
      type = new URLSearchParams(part).get('type');
    } catch {
      type = null;
    }
    if (type && KNOWN.has(type)) return type as AuthLinkType;
  }
  return null;
}

let captured: AuthLinkType = null;
let capturedOnce = false;

/**
 * Snapshot the current URL. Called once from `main.ts` before the app
 * bootstraps; a second call is a no-op so a later, already-cleaned URL can
 * never erase the first answer.
 */
export function captureAuthLinkType(href?: string): AuthLinkType {
  if (capturedOnce) return captured;
  capturedOnce = true;
  const url = href ?? (typeof window === 'undefined' ? '' : window.location.href);
  captured = url ? readAuthLinkType(url) : null;
  return captured;
}

/** What `captureAuthLinkType()` saw, for consumers that run after bootstrap. */
export function capturedAuthLinkType(): AuthLinkType {
  return captured;
}

/** Test seam — lets a spec start from a clean slate. */
export function resetCapturedAuthLinkType(): void {
  captured = null;
  capturedOnce = false;
}
