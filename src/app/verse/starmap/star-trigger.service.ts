import { Injectable, Injector, NgZone, inject } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { AnalyticsService } from '../../core/analytics.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseStarKey } from '../data/verse.models';

/** Keys a source page may claim: comet comes with the tip, cx-guess with the guess, cx-newship via {@link StarTriggerService.codexDetail}. */
export type EarnableStarKey = Exclude<VerseStarKey, 'comet' | 'cx-guess' | 'cx-newship'>;

/**
 * Fire-and-forget star triggers for the source pages (Codex, Hangar, …).
 *
 * `earn()` resolves the current patch line from the Verse digest, claims the
 * star only when the key is in that patch's offered pool, and reports
 * `verse_star_earned` (consent-gated inside AnalyticsService) when it was new.
 * The unlock-toast event (`VerseApiService.starEarned$`) is emitted by the API
 * service itself, so every claim path (this one, the comet tip, the guess) feeds it.
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

  private async claim(key: EarnableStarKey | 'cx-newship', className?: string): Promise<void> {
    try {
      if (!this.auth.isAuthenticated()) return;
      const line = await this.currentLine();
      if (!line) return;
      const id = key === 'cx-newship' ? `${line}|${key}|${(className ?? '').toLowerCase()}` : `${line}|${key}`;
      if (this.done.has(id)) return;
      const pool = await this.pool(line);
      if (!pool.includes(key)) return;
      this.done.add(id);
      if (key === 'cx-newship') {
        // The server compares the hull itself - the answer never reaches the client.
        const res = await this.api.claimNewShip(line, className ?? '');
        // Not the newest ship (or the guess is still open): stay retryable.
        if (!res.ok || res.data === 'guess_first') this.done.delete(id);
        if (res.ok && res.data === 'earned') {
          this.analytics.captureVerse('verse_star_earned', { patch_line: line, star_key: key });
        }
        return;
      }
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
      await this.claim('cx-newship', className);
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
}
