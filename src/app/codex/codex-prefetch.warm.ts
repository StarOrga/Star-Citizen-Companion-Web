import { EnvironmentInjector } from '@angular/core';
import { SilThumbsService } from '../shared/sil-thumb/sil-thumbs.service';
import { CodexKind, CodexService } from './codex.service';
import { CodexLandingDataService } from './landing/codex-landing-data.service';

/**
 * The Codex warmers' work (lazy, see codex-prefetch.ts). Each one reads into the same
 * root service and memo the page reads on arrival, so arriving finds the data parsed.
 */

/** Build first (the landing's memo keys carry its id), then everything `CodexLandingComponent.load()` asks for. */
export async function warmCodexLanding(injector: EnvironmentInjector): Promise<void> {
  const codex = injector.get(CodexService);
  const data = injector.get(CodexLandingDataService);
  await codex.loadCurrentBuild();
  await Promise.all([data.rotationItems(), data.codexNews(), data.loadPatchSummary()]);
}

/** The ship's outline for the detail skeleton (batched tile read) and the Holotable (memoised single read). */
export function warmShipOutline(injector: EnvironmentInjector, className: string): Promise<unknown> {
  injector.get(SilThumbsService).request([{ kind: 'ship', className }]);
  return injector.get(CodexService).silhouette('ship', className);
}

/** The detail read itself, taken by the page's next `getDetail` for this entry. */
export function warmDetail(injector: EnvironmentInjector, kind: string, className: string): Promise<unknown> {
  return injector.get(CodexService).prefetchDetail(kind as CodexKind, className);
}
