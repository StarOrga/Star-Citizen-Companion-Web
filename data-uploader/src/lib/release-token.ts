/**
 * Build-time constants injected by `electron.vite.config.ts` via `define`.
 *
 * The release token is rotated per release (GitHub-Actions sets
 * `SC_RELEASE_TOKEN` before `electron-vite build`). Server checks the
 * `X-SC-Release-Token` header against `desktop_releases.release_token` —
 * unknown tokens = HTTP 403.
 */

// Vite `define` rewrites these identifiers at build time.
declare const __SC_RELEASE_TOKEN__: string;
declare const __SC_API_BASE__: string;
declare const __SC_WEB_BASE__: string;
declare const __SC_TOOL_VERSION__: string;
declare const __SC_SUPABASE_ANON_KEY__: string;
declare const __SC_TELEMETRY_HMAC_KEY__: string;

export const RELEASE_TOKEN: string = __SC_RELEASE_TOKEN__;
/**
 * Supabase project URL where Edge Functions live (desktop-latest,
 * ingest-bundle, check-bundle). All API-style calls go here.
 */
export const API_BASE: string = __SC_API_BASE__;
/**
 * Supabase publishable (anon) key — sent as the `apikey` header for the REST/RPC
 * sync (`list_p4k_bundles_for_collaborator`) and the GoTrue token refresh.
 * Publishable keys are safe in clients (RLS still enforces access), so a
 * hardcoded fallback is fine; CI may override via `SC_SUPABASE_ANON_KEY`.
 */
export const SUPABASE_ANON_KEY: string = __SC_SUPABASE_ANON_KEY__;
/**
 * Angular web-app URL where the OAuth callback page (/uploader/auth) is
 * served. Used by oauth.ts when opening the user's browser. Different
 * domain than API_BASE because the web is on Vercel and the API is on
 * Supabase.
 */
export const WEB_BASE: string = __SC_WEB_BASE__;
export const TOOL_VERSION: string = __SC_TOOL_VERSION__;

/**
 * HMAC-SHA256 key for signing anonymous crash-telemetry requests to the
 * `ingest-telemetry` edge function. Shared anti-abuse secret (NOT a credential
 * to user data), baked in at build time exactly like RELEASE_TOKEN. The dev
 * fallback matches the edge function's own fallback so telemetry works against
 * a local supabase stack without extra config.
 */
export const TELEMETRY_HMAC_KEY: string = __SC_TELEMETRY_HMAC_KEY__;

export const IS_UNSIGNED_DEV_BUILD = RELEASE_TOKEN === 'dev-token-unsigned';

/**
 * Telemetry channel: signed release builds report as 'stable'; unsigned dev
 * builds as 'dev' so their noise never pollutes production crash stats.
 */
export const TELEMETRY_CHANNEL: 'stable' | 'dev' = IS_UNSIGNED_DEV_BUILD ? 'dev' : 'stable';
