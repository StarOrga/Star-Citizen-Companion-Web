import { Injectable, Injector, NgZone, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseStarKey } from '../data/verse.models';

export type EarnableStarKey = Exclude<VerseStarKey, 'comet'>;

/**
 * Fire-and-forget star triggers for the source pages (Codex, Hangar, …).
 *
 * `earn()` resolves the current patch line from the Verse digest, claims the
 * star only when the key is in that patch's offered pool, and reports
 * `verse_star_earned` (consent-gated inside AnalyticsService) when it was new.
 * It never throws and is a silent no-op when signed out — a source page must
 * not care whether the star map exists. All dependencies are resolved lazily
 * so injecting this service costs a source page nothing.
 */
@Injectable({ providedIn: 'root' })
export class StarTriggerService {
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone);
  // Resolved lazily and outside the zone: a source page never instantiates the
  // auth/Verse/analytics stack (or its timers) inside its own stability window.
  private get auth(): AuthService {
    return this.injector.get(AuthService);
  }
  private get api(): VerseApiService {
    return this.injector.get(VerseApiService);
  }
  private get analytics(): AnalyticsService {
    return this.injector.get(AnalyticsService);
  }

  private readonly pools = new Map<string, Promise<readonly VerseStarKey[]>>();
  private readonly newShips = new Map<string, Promise<string | null>>();
  /** `line|key` already claimed (or tried) this session — no repeated RPCs. */
  private readonly done = new Set<string>();

  /** Runs outside the Angular zone: a star round-trip never holds a page's stability. */
  earn(key: EarnableStarKey): Promise<void> {
    return this.zone.runOutsideAngular(() => this.claim(key));
  }

  /**
   * Codex detail opened: `cx-newship` when it is the vehicle this patch's
   * constellation was drawn from (= the patch's newest ship/ground vehicle).
   */
  codexDetail(kind: string, className: string): Promise<void> {
    return this.zone.runOutsideAngular(() => this.claimNewShip(kind, className));
  }

  private async claim(key: EarnableStarKey): Promise<void> {
    try {
      if (!this.auth.isAuthenticated()) return;
      const line = await this.currentLine();
      if (!line) return;
      const id = `${line}|${key}`;
      if (this.done.has(id)) return;
      const pool = await this.pool(line);
      if (!pool.includes(key)) return;
      this.done.add(id);
      const res = await this.api.earnStar(line, key);
      if (!res.ok) {
        this.done.delete(id);
        return;
      }
      if (res.data) this.analytics.captureVerse('verse_star_earned', { patch_line: line, star_key: key });
    } catch {
      /* a star must never break the page that triggered it */
    }
  }

  private async claimNewShip(kind: string, className: string): Promise<void> {
    try {
      if (!this.auth.isAuthenticated() || (kind !== 'ship' && kind !== 'vehicle')) return;
      const line = await this.currentLine();
      if (!line) return;
      const newest = await this.newShip(line);
      if (newest && newest.toLowerCase() === className.toLowerCase()) await this.claim('cx-newship');
    } catch {
      /* see earn() */
    }
  }

  private async currentLine(): Promise<string | null> {
    if (!this.api.digest() && this.api.digestState() !== 'loading') await this.api.loadDigest();
    return this.api.digest()?.patch?.line || null;
  }

  private pool(line: string): Promise<readonly VerseStarKey[]> {
    let p = this.pools.get(line);
    if (!p) {
      p = this.api.starPool(line).then((r) => (r.ok ? r.data : []));
      p.then((keys) => keys.length === 0 && this.pools.delete(line));
      this.pools.set(line, p);
    }
    return p;
  }

  private newShip(line: string): Promise<string | null> {
    let p = this.newShips.get(line);
    if (!p) {
      p = this.api.constellation(line).then((r) => (r.ok && r.data ? r.data.className : null));
      this.newShips.set(line, p);
    }
    return p;
  }
}
