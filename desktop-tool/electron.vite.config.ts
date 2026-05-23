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
      // Default points at the local Angular dev server. CI publishes builds
      // with SC_API_BASE explicitly set to the deployed Vercel URL.
      __SC_API_BASE__: JSON.stringify(process.env['SC_API_BASE'] ?? 'http://localhost:4200'),
      __SC_TOOL_VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.1.0-dev'),
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
