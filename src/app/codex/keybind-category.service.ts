import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from '../auth/auth.service';
import {
  EMPTY_ASSIGNMENT,
  KeybindAssignment,
  isAssigned,
  normalizeAssignment,
} from './keybind-taxonomy';

/** One input action, addressed the way `keybind_categories` keys its rows. */
export interface KeybindTarget {
  actionmap: string;
  actionName: string;
}

interface CategoryRow {
  actionmap: string;
  action_name: string;
  scope: string | null;
  environment: string | null;
  role: string | null;
  activity: string | null;
  action_group: string | null;
}

// The table is one row per assigned action and a build already carries ~1.1k
// actions, so a full assignment set sits right at PostgREST's 1000-row
// response cap — which comes back short rather than as an error. Same paging
// shape as CodexService.listKeybinds().
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/** `actionmap::action_name` — the composite primary key as one map key. */
export function keybindKey(actionmap: string, actionName: string): string {
  return `${actionmap}::${actionName}`;
}

/**
 * Admin-curated category hierarchy (L1–L5) per input action.
 *
 * Reads are public — the chips on /codex/keybinds show for everyone and the
 * public API serves the same data — but every write is admin-only, enforced
 * by RLS (`public.is_admin()`), not by hiding the buttons.
 */
@Injectable({ providedIn: 'root' })
export class KeybindCategoryService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _byAction = signal<ReadonlyMap<string, KeybindAssignment>>(new Map());
  private readonly _loaded = signal(false);

  readonly byAction = this._byAction.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly assignedCount = computed(() => this._byAction().size);

  /** The stored assignment, or an all-null one for an unclassified action. */
  get(actionmap: string, actionName: string): KeybindAssignment {
    return this._byAction().get(keybindKey(actionmap, actionName)) ?? EMPTY_ASSIGNMENT;
  }

  /** Load every assignment. Safe to call repeatedly (e.g. on page re-entry). */
  async load(): Promise<void> {
    this.error.set(null);
    const next = new Map<string, KeybindAssignment>();
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const { data, error } = await this.sb.client
          .from('keybind_categories')
          .select('actionmap, action_name, scope, environment, role, activity, action_group')
          .order('actionmap', { ascending: true })
          .order('action_name', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as CategoryRow[];
        for (const r of batch) {
          next.set(keybindKey(r.actionmap, r.action_name), {
            scope: (r.scope as KeybindAssignment['scope']) ?? null,
            environment: (r.environment as KeybindAssignment['environment']) ?? null,
            role: (r.role as KeybindAssignment['role']) ?? null,
            activity: (r.activity as KeybindAssignment['activity']) ?? null,
            actionGroup: (r.action_group as KeybindAssignment['actionGroup']) ?? null,
          });
        }
        if (batch.length < PAGE_SIZE) break;
      }
      this._byAction.set(next);
      this._loaded.set(true);
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    }
  }

  /**
   * Apply one assignment to every target — the bulk write behind both the
   * per-row editor (a batch of one) and the multi-select bar.
   *
   * An all-null assignment is a removal, not an empty row: the pair is deleted
   * so "unassigned" has exactly one representation (no row), which is what the
   * progress counter and the API's `assigned_only` filter both read.
   */
  async apply(targets: readonly KeybindTarget[], raw: KeybindAssignment): Promise<boolean> {
    if (targets.length === 0) return true;
    const assignment = normalizeAssignment(raw);
    this.saving.set(true);
    this.error.set(null);
    try {
      if (isAssigned(assignment)) {
        const userId = this.auth.user()?.id ?? null;
        const rows = targets.map((t) => ({
          actionmap: t.actionmap,
          action_name: t.actionName,
          scope: assignment.scope,
          environment: assignment.environment,
          role: assignment.role,
          activity: assignment.activity,
          action_group: assignment.actionGroup,
          updated_by: userId,
        }));
        const { error } = await this.sb.client
          .from('keybind_categories')
          .upsert(rows, { onConflict: 'actionmap,action_name' });
        if (error) throw new Error(error.message);
      } else {
        // No `.in()` on a composite key — delete per actionmap, which keeps the
        // request small even for a select-all over one group.
        const byMap = new Map<string, string[]>();
        for (const t of targets) {
          const list = byMap.get(t.actionmap) ?? [];
          list.push(t.actionName);
          byMap.set(t.actionmap, list);
        }
        for (const [actionmap, names] of byMap) {
          const { error } = await this.sb.client
            .from('keybind_categories')
            .delete()
            .eq('actionmap', actionmap)
            .in('action_name', names);
          if (error) throw new Error(error.message);
        }
      }
      // Mirror the write locally instead of re-reading ~1k rows per save.
      const next = new Map(this._byAction());
      for (const t of targets) {
        const key = keybindKey(t.actionmap, t.actionName);
        if (isAssigned(assignment)) next.set(key, assignment);
        else next.delete(key);
      }
      this._byAction.set(next);
      return true;
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
