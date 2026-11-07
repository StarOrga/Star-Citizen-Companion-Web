import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { BetaService } from '../core/beta.service';
import { CodexDetailComponent } from '../codex/codex-detail.component';
import { HqOwnershipService } from '../hq/hq-ownership.service';
import { HQ_VARIANT_PARAM, hqHangar, ownShipLink } from '../hq/hq-routes';
import { HangarService } from './hangar.service';

/**
 * `/hq/hangar/:id` - the page of one of the reader's own ships.
 *
 * Shell beta: the Codex ship view (holotable, variant switch, loadout save, own-ship actions) renders in
 * place under HQ > Hangar > ship; the variant is `?v=` on this URL (the active one when absent). Codex
 * itself has no personal mode there. An unknown id goes back to the hangar list.
 *
 * Without the shell beta the old hangar detail page stays gone: old links and bookmarks are sent on to the
 * ship's personal Codex view (active variant), or to the hangar list when the entry no longer exists.
 */
@Component({
  selector: 'sc-hangar-ship-page',
  standalone: true,
  imports: [TranslatePipe, CodexDetailComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (host(); as h) {
      <!-- One instance per hangar ship: a changed id re-creates the page instead of patching it. -->
      @for (key of [h.id]; track key) {
        <sc-codex-detail [hostClassName]="h.className" [hostShipId]="h.id" />
      }
    } @else {
      <p class="wait" role="status">{{ 'hangar.detail.loading' | translate }}</p>
    }
  `,
  styles: [`.wait { color: var(--sc-fg-2); margin: 0; }`],
})
export class HangarShipPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly auth = inject(AuthService);
  private readonly shellBeta = inject(BetaService).isEnabled('shell');
  private readonly destroyRef = inject(DestroyRef);

  /** The hangar ship this page shows (shell beta), once resolved. */
  protected readonly host = signal<{ id: string; className: string } | null>(null);

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((p) => {
      void this.resolve(p.get('id') ?? '');
    });
  }

  private async resolve(id: string): Promise<void> {
    this.host.set(null);
    if (this.auth.user()) {
      await this.hangar.loadAll();
      await this.ownership.ensureLoaded();
    }
    if (id !== (this.route.snapshot.paramMap.get('id') ?? '')) return; // a newer id took over
    const ship = this.hangar.ships().find((s) => s.id === id);
    if (!ship) {
      void this.router.navigate([hqHangar], { replaceUrl: true });
      return;
    }
    const configs = this.ownership.configsForShip(ship.id);
    if (!this.shellBeta()) {
      const link = ownShipLink(ship, configs);
      void this.router.navigate(link.commands, { queryParams: link.queryParams, replaceUrl: true });
      return;
    }
    // The URL names a variant of THIS ship, else the active (first) one - a variant of another
    // ship of the same hull must not show under this ship's page.
    const wanted = this.route.snapshot.queryParamMap?.get(HQ_VARIANT_PARAM)?.trim() || null;
    const fallback = (configs.find((c) => c.isActive) ?? configs[0])?.id ?? null;
    const legacy = !!this.route.snapshot.queryParamMap?.get('config');
    if (!legacy && fallback && (!wanted || !configs.some((c) => c.id === wanted))) {
      await this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { [HQ_VARIANT_PARAM]: fallback },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
    this.host.set({ id: ship.id, className: ship.shipClassName });
  }
}
