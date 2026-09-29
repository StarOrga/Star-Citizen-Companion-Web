import { describeError } from '../core/describe-error';
import { logWarn } from '../core/log';

/**
 * auth-js error codes (`AuthError.code`) that have their own sentence. The
 * texts are short and never confirm whether an account exists.
 */
const AUTH_CODE_KEYS: Readonly<Record<string, string>> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  email_not_confirmed: 'auth.errors.emailNotConfirmed',
  over_request_rate_limit: 'auth.errors.rateLimit',
  over_email_send_rate_limit: 'auth.errors.rateLimit',
  weak_password: 'auth.errors.weakPassword',
  same_password: 'auth.errors.samePassword',
  email_address_invalid: 'auth.errors.emailInvalid',
  validation_failed: 'auth.errors.emailInvalid',
  otp_expired: 'auth.errors.linkExpired',
};

/** Every key {@link authErrorKey} can return besides the `errors.*` fallbacks. */
export const AUTH_ERROR_KEYS: readonly string[] = [...new Set(Object.values(AUTH_CODE_KEYS))];

/**
 * i18n key for a Supabase auth failure (sign-in, reset, password change). The
 * raw auth-js message ("Invalid login credentials") is logged, never shown.
 * Unknown codes fall back to the general translator (`errors.*`).
 */
export function authErrorKey(err: unknown, op = 'auth'): string {
  logWarn('auth', `${op} failed`, err);
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && AUTH_CODE_KEYS[code]) return AUTH_CODE_KEYS[code];
  return describeError(err).key;
}
