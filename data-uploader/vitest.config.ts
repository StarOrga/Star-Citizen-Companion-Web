import { defineConfig } from 'vitest/config';

/**
 * Vitest needs the same build-time `define`s that `electron.vite.config.ts`
 * injects — without them, importing anything that reaches `lib/release-token.ts`
 * dies with `__SC_RELEASE_TOKEN__ is not defined`, which blocks testing the
 * upload code at all.
 *
 * These mirror the dev fallbacks from `electron.vite.config.ts`. They are dev
 * placeholders, not secrets: tests stub `fetch` and never reach a real server.
 */
export default defineConfig({
  define: {
    __SC_RELEASE_TOKEN__: JSON.stringify('test-token'),
    __SC_API_BASE__: JSON.stringify('http://127.0.0.1:54321'),
    __SC_WEB_BASE__: JSON.stringify('http://127.0.0.1:4200'),
    __SC_TOOL_VERSION__: JSON.stringify('0.0.0-test'),
    __SC_SUPABASE_ANON_KEY__: JSON.stringify('test-anon-key'),
    __SC_TELEMETRY_HMAC_KEY__: JSON.stringify('scc-telemetry-dev-key-v1'),
  },
});
