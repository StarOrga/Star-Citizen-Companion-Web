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

export const RELEASE_TOKEN: string = __SC_RELEASE_TOKEN__;
/**
 * Supabase project URL where Edge Functions live (desktop-latest,
 * ingest-bundle, check-bundle). All API-style calls go here.
 */
export const API_BASE: string = __SC_API_BASE__;
/**
 * Angular web-app URL where the OAuth callback page (/desktop/auth) is
 * served. Used by oauth.ts when opening the user's browser. Different
 * domain than API_BASE because the web is on Vercel and the API is on
 * Supabase.
 */
export const WEB_BASE: string = __SC_WEB_BASE__;
export const TOOL_VERSION: string = __SC_TOOL_VERSION__;

export const IS_UNSIGNED_DEV_BUILD = RELEASE_TOKEN === 'dev-token-unsigned';
