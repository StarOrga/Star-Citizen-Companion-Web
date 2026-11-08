/**
 * Window size for one describe block.
 *
 * Specs run in a 1280 × 800 window (angular.json → test.browserViewport,
 * concept 20261108-2224-vitest-migration). A spec about a layout that only
 * exists at another width — the folded header between the phone layout and
 * 1180 px, a phone sheet — says so here instead of hoping the runner's window
 * happens to fall into the range (Karma's 749 px did, by accident).
 *
 * The window is shared by every spec file of the run (isolate: false), so it
 * goes back to the default after each spec.
 */
import { page } from 'vitest/browser';

/** Keep in step with angular.json → test.options.browserViewport (scripts/vitest-scope.test.mjs checks it). */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;

export function useViewport(width: number, height: number = DEFAULT_VIEWPORT.height): void {
  beforeEach(async () => {
    await page.viewport(width, height);
  });
  afterEach(async () => {
    await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
  });
}
