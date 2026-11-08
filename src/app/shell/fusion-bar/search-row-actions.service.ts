import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CodexService } from '../../codex/codex.service';
import { pinKindOf } from '../../codex/search/codex-search-model';
import type { SearchChip, SearchCta, SearchResultRow } from '../../codex/search/search-result-model';
import { toErrorKey } from '../../core/describe-error';
import { ItemPathService, type PathResult } from '../../hq/data/item-path.service';
import { HqEinsatzService, missionStep } from '../../hq/data/hq-einsatz.service';
import { HqEinsatzPickService } from '../../hq/plan/hq-einsatz-pick.service';
import { hqLocker } from '../../hq/hq-routes';

/** What an action did: an i18n key for the quiet status line, plus whether it failed. */
export interface RowActionResult {
  key: string;
  params?: Record<string, string | number>;
  error?: boolean;
  /** Present where the path can take the step back (the toast offers it). */
  undo?: () => Promise<PathResult>;
}

/** A PathResult as the row's status line: a failure keeps its own `errors.*` / `itemPath.err.*` key. */
function fromPath(r: PathResult, doneKey: string, params: Record<string, string | number>): RowActionResult {
  return r.ok ? { key: doneKey, params, undo: r.undo } : { key: r.key, error: true };
}

/** The row's catalog identity (what an action CTA writes against). */
function idOf(row: SearchResultRow): { kind: string; cls: string; name: string | null } | null {
  if (row.type === 'hit') return { kind: row.hit.kind, cls: row.hit.classNameSlug, name: row.hit.nameLocalized ?? null };
  if (row.type === 'own' && row.classNameSlug) return { kind: row.ownKind === 'item' ? 'item' : 'ship', cls: row.classNameSlug, name: row.title };
  return null;
}

/**
 * The action CTAs of a search row (concept 2026-11-02, B6–B11). The stops of
 * the path live in `sc-item-path`. Failures come back as `errors.*` keys.
 */
@Injectable({ providedIn: 'root' })
export class SearchRowActionsService {
  private readonly router = inject(Router);
  private readonly codex = inject(CodexService);
  private readonly path = inject(ItemPathService);
  private readonly einsaetze = inject(HqEinsatzService);
  private readonly einsatzPick = inject(HqEinsatzPickService);

  /**
   * An action CTA (target null): add, compare, compareWith, inSet.
   * Link CTAs are anchors and never reach this.
   */
  async cta(cta: SearchCta, row: SearchResultRow, title: string, chips: readonly SearchChip[], flagship: string | null): Promise<RowActionResult | null> {
    if (cta.id === 'toEinsatz') return row.type === 'mission' ? this.toEinsatz(row.className, title) : null;
    const id = idOf(row);
    if (!id) return null;
    try {
      switch (cta.id) {
        case 'add':
          return fromPath(await this.path.addToHangar(id.cls, title), 'search.done.hangar', { name: title });
        case 'compare':
        case 'compareWith': {
          if (row.type !== 'hit') return null;
          const kind = pinKindOf(row.hit);
          if (!kind) return null;
          if (cta.id === 'compareWith') {
            const compat = chips.find((c) => c.filter.compatWith)?.filter.compatWith;
            const other = compat && compat.kind === row.hit.kind ? compat.className : kind === 'ship' ? flagship : null;
            if (other && other !== id.cls && !this.codex.isPinned(kind, other)) this.codex.togglePin(kind, other);
          }
          if (!this.codex.isPinned(kind, id.cls)) this.codex.togglePin(kind, id.cls);
          return { key: 'search.done.compare', params: { name: title } };
        }
        case 'inSet':
          void this.router.navigate([hqLocker]);
          return null;
        default:
          return null;
      }
    } catch (err) {
      return { key: toErrorKey('search', `cta ${cta.id}`, err), error: true };
    }
  }

  /** "Zum Einsatz": the mission joins a planned / active Einsatz as a step, or starts a new one. */
  private async toEinsatz(className: string, title: string): Promise<RowActionResult | null> {
    try {
      const open = this.einsaetze.upcoming();
      const choice = await this.einsatzPick.pick(title, open.map((e) => ({ id: e.id, title: e.title, steps: e.steps.length })));
      if (!choice) return null;
      const step = missionStep(className, title);
      if (choice.kind === 'new') {
        if (!this.einsaetze.create({ title, steps: [step] })) return { key: 'search.done.failed', error: true };
        return { key: 'search.done.einsatzNew', params: { name: title } };
      }
      const op = open.find((e) => e.id === choice.id)?.title ?? '';
      if (!this.einsaetze.addStep(choice.id, step)) return { key: 'search.done.einsatzFull', params: { op }, error: true };
      return { key: 'search.done.einsatzAdded', params: { name: title, op } };
    } catch (err) {
      return { key: toErrorKey('search', 'cta toEinsatz', err), error: true };
    }
  }
}
