// Fork guard (concept hv-s4 / s3-fork) — the one gate every write path on a
// `followsOwner` hangar config must pass through before it edits that config.
// Standalone Injectable so it can be injected by any component that owns a
// save/activate action; it never touches the write itself beyond the single
// `forkFollowedLoadout` call the HangarService already exposes (Wave 1/1.5).
//
// Wave 2 (frontend-patch-share) builds this GUARD only. Wiring it into the
// concrete write paths (save bar, hangar config edit/activate) is Wave 2.5
// integration work owned by the stage/hangar-strip agents — see
// docs/concepts/2026-09-20-codex-schiffsansicht-cinematisch-build/wave2-patch-share.md
// for the exact file:line list of call sites that must call `ensureEditable`
// before they write.

import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShipConfig } from '../../hangar/hangar.types';

/** Outcome of {@link CodexHoloForkGuard.ensureEditable}. */
export type ForkGuardResult = 'own' | 'forked' | 'cancelled';

/**
 * Ensures a config is safe to edit directly (`updateConfig`/`activateConfig`)
 * before the caller writes to it.
 *
 * - Not following anything (`followsOwner === false`, own or already-forked
 *   config) → resolves `'own'` immediately, no prompt.
 * - Following an owner (`followsOwner === true`) → shows the hv-s4 question
 *   ONCE per call ("Eigentümer werden? …", irreversible) via `window.confirm`
 *   (same confirmation idiom the rest of the app uses — see
 *   `admin.component.ts`/`p4k-history.component.ts`). Confirmed → calls
 *   `HangarService.forkFollowedLoadout(config.id, {})` (no patch — the
 *   caller performs its own write immediately after) and resolves `'forked'`
 *   on success. Declined, or the fork write itself fails → `'cancelled'`,
 *   and the caller MUST NOT write.
 */
@Injectable({ providedIn: 'root' })
export class CodexHoloForkGuard {
  private readonly hangar = inject(HangarService);
  private readonly t = inject(TranslateService);

  async ensureEditable(config: Pick<HangarShipConfig, 'id' | 'followsOwner'>): Promise<ForkGuardResult> {
    if (!config.followsOwner) return 'own';
    const question = this.t.instant('codex.holo.patch.forkGuard.question') as string;
    if (!window.confirm(question)) return 'cancelled';
    const forked = await this.hangar.forkFollowedLoadout(config.id, {});
    return forked ? 'forked' : 'cancelled';
  }
}
