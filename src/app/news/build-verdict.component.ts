import { ChangeDetectionStrategy, Component, computed, inject, input, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChannelBuildVotes, ChannelBuildVotesService } from './channel-build-votes.service';
import { CommunityVerdictComponent } from './community-verdict.component';
import { StabilityChipComponent, type StabilityChipData } from './stability-chip.component';

/**
 * One running Hotfix / PTU build on the dossier (#885): its label, the chip
 * (computed number plus the build's community correction) and the
 * Community-Urteil card bound to THIS build's votes. The only place a build
 * can be voted on — the hub row shows the result.
 */
@Component({
  selector: 'sc-build-verdict',
  standalone: true,
  imports: [TranslatePipe, StabilityChipComponent, CommunityVerdictComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = build();
    <article class="bv" [attr.data-ch]="b.channel">
      <header>
        <h4>
          <small>{{ ('verse.hub.channel.' + b.channel) | translate }}</small>
          <b>{{ b.version }}</b>
          @if (b.wave !== null) { <span>· {{ 'verse.hub.wave' | translate: { n: b.wave } }}</span> }
        </h4>
        @if (src().blind()) {
          <span class="hidden">{{ 'stability.vote.blindTitle' | translate }}</span>
        } @else {
          <sc-stability-chip [data]="chip()" [linked]="false" />
        }
      </header>
      <sc-community-verdict [line]="label()" [stability]="b.stability" [source]="src()" />
    </article>
  `,
  styles: [`
    :host { display: block; }
    .bv { display: flex; flex-direction: column; gap: 10px; }
    header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
    h4 { margin: 0; display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; font-size: max(0.95rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    h4 small { font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-accent); }
    h4 span { font-weight: 400; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
    .hidden { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }
  `],
})
export class BuildVerdictComponent {
  private readonly votes = inject(ChannelBuildVotesService);

  readonly build = input.required<ChannelBuildVotes>();

  /** Re-created only when the build identity changes, so the card keeps its state across reloads. */
  private readonly key = computed(() => `${this.build().channel}:${this.build().version}`);
  readonly src = computed(() => {
    this.key();
    return untracked(() => this.votes.source(this.build().channel, this.build().version));
  });
  readonly label = computed(() => `${this.build().version} ${this.build().channel === 'ptu' ? 'PTU' : 'Hotfix'}`);
  readonly chip = computed<StabilityChipData>(() => {
    const b = this.build();
    return {
      line: b.line, percent: b.stability, early: b.channel === 'ptu', finished: false, previous: null, previousLabel: null,
      build: { channel: b.channel, version: b.version },
    };
  });
}
