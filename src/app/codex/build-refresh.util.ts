import { Signal, effect, untracked } from '@angular/core';

/**
 * Reloads a reader when `CodexService.buildRefresh` moves — i.e. when
 * the service switched the reader to a new LIVE build after the tab came back
 * (`revalidateLiveBuild`). The value at call time is skipped, so the initial
 * load stays with the reader's own code. Call in an injection context
 * (constructor / field initialiser).
 */
export function reloadOnBuildRefresh(svc: { buildRefresh: Signal<number> }, reload: () => void): void {
  const start = untracked(svc.buildRefresh);
  effect(() => {
    if (svc.buildRefresh() === start) return;
    untracked(reload);
  });
}
