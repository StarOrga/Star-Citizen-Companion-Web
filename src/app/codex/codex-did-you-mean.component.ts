import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../core/modified-click.util';
import { normalizeSearch } from './codex-search';

/**
 * "Did you mean: A · B" under a search that found nothing (audit L06). Each
 * name is a real anchor to the same page with `?q=<name>` (other params kept),
 * so a middle click opens that search in a new tab; a plain left click is
 * handed to the host through `pick`, which runs the search in place.
 */
@Component({
  selector: 'sc-codex-did-you-mean',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (links().length > 0) {
      <p class="did-you-mean">
        <span class="label">{{ 'codex.search.didYouMean' | translate }}</span>
        @for (l of links(); track l.name; let last = $last) {
          <a class="suggestion" [attr.href]="l.href" (click)="onClick($event, l.name)">{{ l.name }}</a>
          @if (!last) {
            <span class="sep" aria-hidden="true">·</span>
          }
        }
      </p>
    }
  `,
  styles: [`
    :host { display: block; }
    .did-you-mean { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px 8px; margin: 10px 0 0; color: var(--sc-fg-2); }
    .suggestion { color: var(--sc-accent); text-decoration: none; border-radius: 4px; }
    .suggestion:hover { text-decoration: underline; }
    .suggestion:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; text-decoration: underline; }
    .sep { color: var(--sc-fg-2); }
    @media (pointer: coarse) {
      .suggestion { display: inline-flex; align-items: center; min-height: max(48px, var(--sc-tap-min)); padding: 0 4px; }
    }
  `],
})
export class CodexDidYouMeanComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly location = inject(Location);

  /** Suggested record names, best first. */
  readonly names = input<readonly string[]>([]);
  /** A plain left click on a suggestion: run that search in place. */
  readonly pick = output<string>();

  readonly links = computed(() =>
    this.names().map((name) => ({ name, href: this.hrefFor(name) })),
  );

  onClick(ev: MouseEvent, name: string): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.pick.emit(name);
  }

  private hrefFor(name: string): string | null {
    try {
      const tree = this.router.createUrlTree([], {
        relativeTo: this.route ?? undefined,
        queryParams: { q: name },
        queryParamsHandling: 'merge',
      });
      return this.location.prepareExternalUrl(this.router.serializeUrl(tree));
    } catch {
      return null; // outside the router (tests): the in-place click still works
    }
  }
}

/**
 * Merge per-kind suggestion lists into one: case-insensitive dedupe, and a
 * family of variants sharing a name prefix ("Aegis Gladius", "Aegis Gladius
 * Dunlevy") collapses to its shortest member. Order follows the first list
 * position a family appeared at; at most `max` names.
 */
export function mergeSuggestions(lists: readonly (readonly string[])[], max = 3): string[] {
  const ordered: string[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  // Interleave so each kind's best guess outranks another kind's third.
  for (let i = 0; i < longest; i++) {
    for (const l of lists) if (l[i]) ordered.push(l[i].trim());
  }
  const out: { name: string; key: string }[] = [];
  for (const name of ordered) {
    const key = normalizeSearch(name);
    if (!key) continue;
    const family = out.findIndex((o) => isPrefixWord(o.key, key) || isPrefixWord(key, o.key));
    if (family < 0) {
      out.push({ name, key });
    } else if (key.length < out[family].key.length) {
      out[family] = { name, key };
    }
  }
  return out.slice(0, max).map((o) => o.name);
}

/** `short` equals `long`, or is a whole-word prefix of it. */
function isPrefixWord(short: string, long: string): boolean {
  if (short === long) return true;
  return long.startsWith(short) && /[\s\-_]/.test(long.charAt(short.length));
}
