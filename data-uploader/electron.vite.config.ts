import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
      },
      rollupOptions: {
        external: [
          'electron',
          'electron-updater',
          'electron-log',
          'yauzl',
          'node:fs',
          'node:path',
          'node:http',
          'node:crypto',
          'node:os',
          'node:child_process',
          'node:readline',
        ],
      },
    },
    define: {
      __SC_RELEASE_TOKEN__: JSON.stringify(process.env['SC_RELEASE_TOKEN'] ?? 'dev-token-unsigned'),
      // API_BASE = Supabase project URL (where Edge Functions live —
      // desktop-latest, ingest-bundle, check-bundle). The Tool talks to
      // these directly, NOT through the web app. Dev fallback assumes a
      // local supabase stack on port 54321; real dev usually overrides
      // with SC_API_BASE=https://hcnqhvzlavdycidqyaai.supabase.co.
      __SC_API_BASE__: JSON.stringify(
        process.env['SC_API_BASE'] ?? 'http://127.0.0.1:54321',
      ),
      // WEB_BASE = Angular app URL (where the OAuth callback page
      // /desktop/auth is served). Different concern: this is the URL the
      // user's browser navigates to during the loopback OAuth flow. Dev
      // = local ng serve on 4200; prod = Vercel deployment URL once
      // it's set up. CI must set BOTH env vars; falling back to the
      // default in a packaged build is always wrong.
      __SC_WEB_BASE__: JSON.stringify(
        process.env['SC_WEB_BASE'] ?? 'http://127.0.0.1:4200',
      ),
      __SC_TOOL_VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.1.0-dev'),
      // Supabase publishable (anon) key — apikey header for the REST/RPC sync
      // and the GoTrue token refresh. Publishable keys are client-safe (RLS
      // enforces access); the fallback is the prod key so no CI change is
      // required. Override via SC_SUPABASE_ANON_KEY for other projects/stacks.
      __SC_SUPABASE_ANON_KEY__: JSON.stringify(
        process.env['SC_SUPABASE_ANON_KEY'] ?? 'sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ',
      ),
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        // Sandboxed preloads MUST be CommonJS (Electron requirement) —
        // ESM (.mjs) fails silently, leaving window.sc undefined and the
        // renderer's init() crashing on the first IPC call.
        formats: ['cjs'],
        fileName: () => 'index.cjs',
      },
      rollupOptions: {
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
      },
    },
    publicDir: resolve(__dirname, 'src/i18n'),
  },
});
