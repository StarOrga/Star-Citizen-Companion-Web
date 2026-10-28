import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { VerseNewsItem } from '../../../news/news.service';
import { relativeTime } from '../../../news/relative-time';
import type { VerseDigestItem, VerseDoor } from '../../data/verse.models';
import { verseItemLink } from '../verse-item-link';
import { AccordionIntent } from './briefing-accordion';
import { HubChannel, HubStat, deltaText, verdictWord } from './briefing-hub';

/** The mosaic's six slots under the gallery feature: one 2×2, one 2×1, four small; newer = bigger. */
export const MOSAIC_SLOTS = ['m1', 'm2', 's1', 's2', 's3', 's4'] as const;

/**
 * The hub below the stage, "one cinematic picture": the big stage planet
 * scrolled down behind three box-less columns — News | Patches | Galerie.
 * Every column opens with a real-anchor head (mini planet + area word +
 * chevron) and one feature of identical size, followed by three fixed rows,
 * so all three columns end on one line:
 *
 * - News: an accordion, the newest entry open, hover intent in TS
 *   ({@link AccordionIntent}); leaving the list returns to the newest.
 * - Patches: the LIVE patch's RSI image with a verdict chip and the
 *   Stabilität / Bekannte Probleme grid, then the fixed Hotfix / PTU / Evocati
 *   slots in the same grid and wording ("gerade keiner im Lauf" when quiet).
 * - Galerie: the newest image, then a dense mosaic of six.
 */
@Component({
  selector: 'sc-briefing-hub',
  standalone: true,
  imports: [RouterLink, TranslatePipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing-hub.component.html',
  styleUrl: './briefing-hub.component.scss',
})
export class BriefingHubComponent {
  readonly news = input<readonly VerseNewsItem[]>([]);
  readonly newsLoading = input(false);
  readonly newsError = input<string | null>(null);
  readonly live = input<HubChannel | null>(null);
  readonly liveDays = input<number | null>(null);
  readonly patchImage = input<string | null>(null);
  readonly channels = input<readonly HubChannel[]>([]);
  readonly gallery = input<readonly VerseDigestItem[]>([]);

  readonly retryNews = output<void>();
  readonly openItem = output<VerseDigestItem>();
  readonly openDoor = output<VerseDoor>();

  readonly acc = new AccordionIntent(0);
  readonly slots = MOSAIC_SLOTS;
  private readonly translate = inject(TranslateService);

  readonly verdict = computed(() => verdictWord(this.live()?.stats.stability.value ?? null));
  readonly galleryMain = computed(() => this.gallery()[0] ?? null);
  readonly mosaic = computed(() => MOSAIC_SLOTS.map((slot, i) => ({ slot, item: this.gallery()[i + 1] ?? null })));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.acc.destroy());
  }

  ago(iso: string): string {
    return relativeTime(iso, Date.now(), (k, p) => this.translate.instant(k, p));
  }

  delta(s: HubStat, arrows: boolean): string {
    return deltaText(s, arrows);
  }

  link(item: VerseDigestItem): ReturnType<typeof verseItemLink> {
    return verseItemLink(item.url);
  }

  sinceKey(days: number): string {
    return days <= 0 ? 'verse.hub.liveSinceToday' : days === 1 ? 'verse.hub.liveSinceOne' : 'verse.hub.liveSince';
  }

  /** Focus left the accordion: back to the newest, like the pointer leaving. */
  accFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (!next || !(ev.currentTarget as HTMLElement).contains(next)) this.acc.leave();
  }
}
