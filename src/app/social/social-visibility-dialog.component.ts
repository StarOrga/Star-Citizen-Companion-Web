import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScDialogDirective } from '../shared/dialog/sc-dialog.directive';
import { ScSelectComponent, ScSelectOption } from '../shared/sc-select.component';
import { ScSegmentOption, ScSegmentedComponent } from '../shared/segmented-control.component';
import { FriendsService } from './friends.service';
import { edgeLabel } from './friends.types';
import { SocialService } from './social.service';
import {
  SocialVisibility,
  VISIBILITY_FACETS,
  VisibilityFacet,
  VisibilityOverride,
  effectiveVisibility,
} from './social.types';

/**
 * What friends see (C21, R4): the general switches and a per-friend override,
 * in a popup on the Social page. Every change saves at once (no save button);
 * "inherit" means the friend follows the general setting. All four are on by
 * default (D9).
 */
@Component({
  selector: 'sc-social-visibility-dialog',
  standalone: true,
  imports: [TranslatePipe, ScDialogDirective, ScSelectComponent, ScSegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop"></div>
    <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="social-vis-title"
             scDialog (scDialogEscape)="closed.emit()">
      <header>
        <h3 id="social-vis-title">{{ 'social.visibility.title' | translate }}</h3>
        <button type="button" class="sc-btn micro" (click)="closed.emit()">{{ 'social.visibility.done' | translate }}</button>
      </header>
      <div class="body">
        @if (social.error(); as key) {
          <div class="flash error" role="alert">{{ key | translate }}</div>
        }
        @if (social.loadError(); as key) {
          <div class="flash error" role="alert">
            {{ key | translate }}
            <button type="button" class="sc-btn micro" (click)="reload()">{{ 'errors.retry' | translate }}</button>
          </div>
        }
        @if (general(); as g) {
          <h4>{{ 'social.visibility.general' | translate }}</h4>
          <p class="hint">{{ 'social.visibility.generalHint' | translate }}</p>
          <ul class="facets">
            @for (f of facets; track f) {
              <li>
                <span class="facet-text">
                  <span class="facet-name">{{ 'social.visibility.facet.' + f | translate }}</span>
                  <span class="hint">{{ 'social.visibility.facetHint.' + f | translate }}</span>
                </span>
                <button type="button" class="switch" role="switch" [class.on]="g[f]" [attr.aria-checked]="g[f]"
                        [attr.aria-label]="'social.visibility.facet.' + f | translate"
                        [disabled]="social.busy()" (click)="setGeneral(f, !g[f])">
                  <span class="knob"></span>
                </button>
              </li>
            }
          </ul>

          <h4>{{ 'social.visibility.perFriend' | translate }}</h4>
          <p class="hint">{{ 'social.visibility.perFriendHint' | translate }}</p>
          @if (friendOptions().length === 0) {
            <p class="hint empty">{{ 'social.visibility.noFriends' | translate }}</p>
          } @else {
            <sc-select [options]="friendOptions()" [value]="friendId()" [allowEmpty]="false"
                       [ariaLabel]="'social.visibility.perFriend' | translate"
                       (valueChange)="friendId.set($event)" />
            @if (friendId(); as fid) {
              <ul class="facets">
                @for (f of facets; track f) {
                  <li>
                    <span class="facet-name">{{ 'social.visibility.facet.' + f | translate }}</span>
                    <sc-segmented [options]="overrideOptions" [value]="overrideValue(fid, f)"
                                  [ariaLabel]="'social.visibility.facet.' + f | translate"
                                  (valueChange)="setOverride(fid, f, $event)" />
                  </li>
                }
              </ul>
              <p class="hint">
                {{ 'social.visibility.result' | translate }}
                @for (f of shownFacets(fid); track f; let last = $last) {
                  {{ 'social.visibility.facet.' + f | translate }}{{ last ? '' : ',' }}
                } @empty {
                  {{ 'social.visibility.nothing' | translate }}
                }
              </p>
            }
          }
        } @else if (!social.loadError()) {
          <p class="hint">{{ 'social.visibility.loading' | translate }}</p>
        }
      </div>
    </section>
  `,
  styles: [`
    :host { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; }
    .backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / 0.6); }
    .dialog {
      position: relative; width: min(600px, calc(100vw - 2 * var(--sc-space-3, 12px))); max-height: 88vh; max-height: 88dvh;
      display: flex; flex-direction: column; background: var(--sc-surface, #111); border: 1px solid var(--sc-border);
      border-radius: var(--sc-radius, 10px);
    }
    header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border-bottom: 1px solid var(--sc-border); }
    h3 { margin: 0; font-size: 1.1rem; }
    h4 { margin: var(--sc-space-4, 16px) 0 var(--sc-space-1, 4px); font-size: 0.9rem; font-family: var(--sc-font-display); letter-spacing: 0.05em; }
    h4:first-child { margin-top: 0; }
    .body { overflow-y: auto; padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px) var(--sc-space-4, 16px); }
    .hint { display: block; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); margin: 0; }
    .hint.empty { margin-top: 8px; font-style: italic; }
    .flash.error {
      padding: 10px 14px; border-radius: 4px; font-size: 0.9rem; margin-bottom: 10px; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap;
      background: rgba(248, 113, 113, 0.1); border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .facets { list-style: none; margin: 8px 0 12px; padding: 0; }
    .facets li { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: var(--sc-space-2, 8px) 0; border-bottom: 1px solid var(--sc-border); }
    .facets li:last-child { border-bottom: 0; }
    .facet-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 200px; }
    .facet-name { color: var(--sc-fg-0); }
    .switch {
      flex: 0 0 auto; position: relative; width: 44px; height: 26px; padding: 0; border-radius: 999px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-2); cursor: pointer;
    }
    .switch .knob { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: var(--sc-fg-2); transition: transform 0.15s ease, background 0.15s ease; }
    .switch.on { border-color: var(--sc-accent); background: rgba(0, 212, 255, 0.15); }
    .switch.on .knob { transform: translateX(18px); background: var(--sc-accent); }
    .switch:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .switch:disabled { opacity: 0.6; cursor: default; }
    .sc-btn.micro { padding: 4px 10px; font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.04em; }
    @media (prefers-reduced-motion: reduce) { .switch .knob { transition: none; } }
    @media (pointer: coarse) { .switch { min-height: 48px; width: 56px; border-radius: 24px; } .switch .knob { top: 14px; } .sc-btn { min-height: 48px; } }
  `],
})
export class SocialVisibilityDialogComponent implements OnInit {
  readonly social = inject(SocialService);
  private readonly friends = inject(FriendsService);

  readonly closed = output<void>();
  readonly facets = VISIBILITY_FACETS;

  readonly overrideOptions: readonly ScSegmentOption[] = [
    { value: 'inherit', labelKey: 'social.visibility.inherit' },
    { value: 'on', labelKey: 'social.visibility.on' },
    { value: 'off', labelKey: 'social.visibility.off' },
  ];

  readonly general = computed(() => this.social.visibility()?.general ?? null);
  readonly friendId = signal<string | null>(null);

  readonly friendOptions = computed<ScSelectOption[]>(() =>
    this.friends.graph().friends.map((f) => ({ value: f.user_id, labelKey: '', label: edgeLabel(f) }) as ScSelectOption),
  );

  ngOnInit(): void {
    void this.social.loadVisibility();
    this.friendId.set(this.friendOptions()[0]?.value ?? null);
  }

  reload(): void {
    void this.social.loadVisibility();
  }

  private overrideOf(friendId: string): VisibilityOverride {
    const row = this.social.visibility()?.overrides.find((o) => o.user_id === friendId);
    return {
      hangar: row?.hangar ?? null,
      flagship: row?.flagship ?? null,
      presence: row?.presence ?? null,
      stats: row?.stats ?? null,
    };
  }

  overrideValue(friendId: string, facet: VisibilityFacet): string {
    const v = this.overrideOf(friendId)[facet];
    return v === null ? 'inherit' : v ? 'on' : 'off';
  }

  shownFacets(friendId: string): VisibilityFacet[] {
    const g = this.general();
    if (!g) return [];
    const eff = effectiveVisibility(g, this.overrideOf(friendId));
    return VISIBILITY_FACETS.filter((f) => eff[f]);
  }

  async setGeneral(facet: VisibilityFacet, on: boolean): Promise<void> {
    const g = this.general();
    if (!g) return;
    const next: SocialVisibility = { ...g, [facet]: on };
    await this.social.setVisibility(next);
  }

  async setOverride(friendId: string, facet: VisibilityFacet, choice: string): Promise<void> {
    const next: VisibilityOverride = { ...this.overrideOf(friendId), [facet]: choice === 'inherit' ? null : choice === 'on' };
    await this.social.setFriendVisibility(friendId, next);
  }
}
