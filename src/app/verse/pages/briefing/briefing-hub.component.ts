import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import type { VerseNewsItem } from '../../../news/news.service';
import { relativeTime } from '../../../news/relative-time';
import type { VerseDigestItem, VerseDoor } from '../../data/verse.models';
import { verseItemLink } from '../verse-item-link';
import { AccordionIntent } from './briefing-accordion';
import { StabilityChipComponent } from '../../../news/stability-chip.component';
import { HubChannel } from './briefing-hub';

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
 *   ({@link AccordionIntent}); leaving the list keeps the open entry.
 * - Patches: the LIVE patch's RSI image with its stability chip, then the fixed
 *   Hotfix / PTU / Evocati slots, each with its own chip (Evocati none) and the
 *   same wording ("gerade keiner im Lauf" when quiet).
 * - Galerie: the newest image, then a dense mosaic of up to six (only filled tiles).
 */
@Component({
  selector: 'sc-briefing-hub',
  standalone: true,
  imports: [RouterLink, TranslatePipe, NgTemplateOutlet, StabilityChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './briefing-hub.component.html',
  styleUrl: './briefing-hub.component.scss',
  host: { '[class.incoming]': 'incoming()' },
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
  /** The stage planets are still on their way into the heads (briefing-dock): the heads' own planet and word wait. */
  readonly incoming = input(false);

  readonly retryNews = output<void>();
  readonly openItem = output<VerseDigestItem>();
  readonly openDoor = output<VerseDoor>();

  readonly acc = new AccordionIntent(0);
  readonly slots = MOSAIC_SLOTS;
  private readonly translate = inject(TranslateService);

  /** Image URLs that failed to load: the next candidate takes their place. */
  private readonly broken = signal<ReadonlySet<string>>(new Set());
  /** More candidates than slots (see HUB_GALLERY): every shown tile is a real, linkable, loading picture. */
  private readonly candidates = computed(() => this.gallery().filter((g) => !this.broken().has(g.image ?? '') && !!verseItemLink(g.url)));
  readonly galleryMain = computed(() => this.candidates()[0] ?? null);
  /** Only filled slots; fewer pictures → fewer tiles (the grid adapts via data-n), never an empty one. */
  readonly mosaic = computed(() =>
    this.candidates().slice(1, 1 + MOSAIC_SLOTS.length).map((item, i) => ({ slot: MOSAIC_SLOTS[i], item })));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.acc.destroy());
  }

  ago(iso: string): string {
    return relativeTime(iso, Date.now(), (k, p) => this.translate.instant(k, p));
  }

  /** A gallery picture failed to load: drop it so the next candidate fills its tile. */
  imgFailed(url: string | null): void {
    if (!url) return;
    this.broken.update((b) => new Set(b).add(url));
  }

  link(item: VerseDigestItem): ReturnType<typeof verseItemLink> {
    return verseItemLink(item.url);
  }

  sinceKey(days: number): string {
    return days <= 0 ? 'verse.hub.liveSinceToday' : days === 1 ? 'verse.hub.liveSinceOne' : 'verse.hub.liveSince';
  }

  /** Focus left the accordion: like the pointer leaving, the open entry stays. */
  accFocusOut(ev: FocusEvent): void {
    const next = ev.relatedTarget as Node | null;
    if (!next || !(ev.currentTarget as HTMLElement).contains(next)) this.acc.leave();
  }
}
