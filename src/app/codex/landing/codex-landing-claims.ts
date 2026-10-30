import { TranslateService } from '@ngx-translate/core';
import { LandingCategory, LandingCodexCategory } from './codex-landing-data.types';

/** Claims per category the hero title rolls through. */
export const CLAIMS_PER_CATEGORY = 7;
/** How long one claim stands (brief: 7 s). */
export const CLAIM_MS = 7000;
/** Static claim lines per category in `codex.landing.claims.<category>.s<n>`. */
export const STATIC_CLAIMS = 4;

/** Facts the data-driven claims are built from. */
export interface ClaimFacts {
  patch: string | null;
  news: LandingCodexCategory | null;
}

/**
 * The seven hero claims of a category: concrete patch news first where the
 * data has it ("14 neue Schiffe in 4.3.", "Drake Golem OX ist flugbereit."),
 * mixed with the category's static lines; always exactly
 * {@link CLAIMS_PER_CATEGORY} lines, no line twice in a row.
 */
export function buildClaims(t: Pick<TranslateService, 'instant'>, category: LandingCategory, facts: ClaimFacts): string[] {
  const k = (key: string, params?: Record<string, unknown>) => t.instant(`codex.landing.claims.${category}.${key}`, params) as string;
  const statics = Array.from({ length: STATIC_CLAIMS }, (_, i) => k(`s${i + 1}`));
  const news = facts.news;
  const patch = facts.patch;
  const names = (news?.entries ?? []).filter((e) => !e.announced).map((e) => e.name);
  const data: string[] = [];
  if (news && patch && news.count > 0) data.push(k('count', { count: news.count, patch }));
  if (names[0]) data.push(k('name', { name: names[0], patch: patch ?? '' }));
  if (news && news.announced > 0 && patch) data.push(k('announced', { announced: news.announced, count: news.count }));
  if (names[1]) data.push(k('name', { name: names[1], patch: patch ?? '' }));
  if (names[2]) data.push(k('name', { name: names[2], patch: patch ?? '' }));
  // Interleave: data, static, data, static … so the roll mixes news and claim.
  const out: string[] = [];
  let d = 0;
  let s = 0;
  while (out.length < CLAIMS_PER_CATEGORY && (d < data.length || s < statics.length)) {
    const takeData = (out.length % 2 === 0 && d < data.length) || s >= statics.length;
    const next = takeData ? data[d++] : statics[s++];
    if (next && !out.includes(next)) out.push(next);
  }
  // Fewer distinct lines than seven: repeat the statics (never the same line twice in a row).
  let i = 0;
  while (out.length < CLAIMS_PER_CATEGORY && statics.length) {
    const next = statics[i++ % statics.length];
    if (next !== out[out.length - 1]) out.push(next);
    else if (statics.length === 1) out.push(next);
  }
  return out.slice(0, CLAIMS_PER_CATEGORY);
}

/**
 * Which claim the hero shows. Each category keeps its own cursor: a category
 * that comes back to the table continues with its next claim instead of
 * repeating the first. While the category stays (rotation held), the claim
 * advances every {@link CLAIM_MS} unless paused (hover/focus, hidden tab,
 * reduced motion — WCAG 2.2.2).
 */
export class ClaimCursor {
  private readonly cursor = new Map<LandingCategory, number>();
  private current: LandingCategory | null = null;
  private index = 0;

  /** A category comes onto the table: returns its claim index. */
  enter(category: LandingCategory): number {
    if (category === this.current) return this.index;
    this.current = category;
    this.index = this.cursor.get(category) ?? 0;
    this.cursor.set(category, (this.index + 1) % CLAIMS_PER_CATEGORY);
    return this.index;
  }

  /** The claim dwell ran out while the category stayed: the next claim. */
  step(): number {
    if (!this.current) return 0;
    this.index = (this.index + 1) % CLAIMS_PER_CATEGORY;
    this.cursor.set(this.current, (this.index + 1) % CLAIMS_PER_CATEGORY);
    return this.index;
  }

  get value(): number {
    return this.index;
  }
}
