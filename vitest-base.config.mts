// Runner config for `npm test` (angular.json → test → runnerConfig). The Angular unit-test builder owns discovery, the build,
// the browser provider and the TestBed setup; this file only adds what the
// Jasmine suite took for granted.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Jasmine undoes every spy after its spec; Vitest only does when asked.
    // Without this a `vi.spyOn(window, 'requestAnimationFrame')` outlives
    // its spec and starves every later frame-driven spec in the same file.
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    // Jasmine ran the suite in random order (Karma's default); keep that, so
    // an order dependence still shows up instead of hiding behind file order.
    sequence: { shuffle: { tests: true, files: false } },
  },
});
