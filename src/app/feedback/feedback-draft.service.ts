import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';
import type { PendingImage } from '../admin/feedback/feedback-composer.component';
import {
  FEEDBACK_IMAGES_BUCKET,
  feedbackImagePath,
  uploadFeedbackImages,
} from './feedback-images.util';
import {
  DraftImageRef,
  FeedbackDraftRow,
  draftScopes,
  feedbackIdFromScope,
  isEmptyDraft,
  parseDraftRow,
} from './feedback-draft.types';

/** Quiet period after the last keystroke before a draft is written. */
const SAVE_DEBOUNCE_MS = 700;
/** Backoff before retrying a failed write (network blip, expired token). */
const RETRY_DELAY_MS = 4000;
/** How often one draft retries on its own before it waits for the next edit. */
const MAX_RETRIES = 5;

/**
 * localStorage keys the two new-topic composers used before drafts moved to the
 * account. Imported once, then removed — see `importLegacyDrafts`.
 */
const LEGACY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['sc.userFeedback.draft', draftScopes.userNew],
  ['sc.adminFeedback.draft', draftScopes.adminNew],
];

/** In-memory state of one composer's draft. */
export interface DraftEntry {
  scope: string;
  feedbackId: string | null;
  body: string;
  images: DraftImageRef[];
  updatedAt: string;
  /** The in-memory value has not reached the server (yet). */
  dirty: boolean;
  /** The last write attempt failed; the value is still held locally. */
  failed: boolean;
}

/**
 * Account-bound drafts for every feedback composer
 * (`public.feedback_drafts`, migration 20260729120000).
 *
 * WHY THIS EXISTS
 *   Someone wrote a long topic, never pressed send, and closed the tab — gone.
 *   The old net was one localStorage key for the new-topic box, text only, and
 *   only for users who had opted into `preferences` storage. Replies had none,
 *   attachments had none, and another device had none.
 *
 * THE RULES IT ENFORCES
 *   1. Everything typed anywhere in the feedback surface is kept: text and
 *      attachments, new topic and every reply box.
 *   2. It is kept on the ACCOUNT, so it survives a reload, a browser restart
 *      and a device change, and needs no storage consent — it is the user's own
 *      content, not a convenience preference.
 *   3. It is removed by exactly two things: a successful send, or the user
 *      pressing discard. Never by a reload, a closed panel or a failed write.
 *
 * WRITES
 *   Staged in memory on every keystroke, written debounced and serialized per
 *   scope (never two writes in flight for one composer, so a slow request can
 *   not land on top of a newer one). A failed write keeps the value and retries;
 *   it never clears anything. `pagehide` flushes with `fetch(keepalive)`, which
 *   is the one path that still completes while the tab is being torn down —
 *   exactly the case that lost the original draft.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackDraftService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _entries = signal<ReadonlyMap<string, DraftEntry>>(new Map());
  private readonly _loaded = signal(false);

  /** All known drafts, keyed by scope. */
  readonly entries = this._entries.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  /** Scopes with unsaved local changes — used by the tests and the flush path. */
  readonly dirtyScopes = computed(() =>
    [...this._entries().values()].filter((e) => e.dirty).map((e) => e.scope),
  );

  private loadPromise: Promise<void> | null = null;
  private loadedFor: string | null = null;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly retries = new Map<string, number>();

  constructor() {
    // A sign-out/sign-in must not leak one account's drafts into the next.
    effect(() => {
      const uid = this.auth.user()?.id ?? null;
      if (uid === this.loadedFor) return;
      this.reset();
    });

    if (typeof window !== 'undefined') {
      const onHide = () => this.flushBeacon();
      // `pagehide` covers tab close, navigation and the bfcache; the
      // visibility hook additionally covers mobile backgrounding, where
      // `pagehide` is not guaranteed to fire at all.
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') this.flushBeacon();
      };
      window.addEventListener('pagehide', onHide);
      document.addEventListener('visibilitychange', onVisibility);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('pagehide', onHide);
        document.removeEventListener('visibilitychange', onVisibility);
      });
    }
  }

  private get uid(): string | null {
    return this.auth.user()?.id ?? null;
  }

  // ---- Loading -----------------------------------------------------------

  /**
   * Load every draft of the signed-in user, once. Composers await this before
   * they render, so a restored draft is on screen from the first frame instead
   * of appearing under the user's cursor a moment later.
   */
  ready(): Promise<void> {
    const uid = this.uid;
    if (!uid) {
      this._loaded.set(true);
      return Promise.resolve();
    }
    if (this.loadPromise && this.loadedFor === uid) return this.loadPromise;
    this.loadedFor = uid;
    this.loadPromise = this.load();
    return this.loadPromise;
  }

  private async load(): Promise<void> {
    const forUid = this.loadedFor;
    const { data, error } = await this.sb.client
      .from('feedback_drafts')
      .select('scope, feedback_id, body, images, updated_at');
    // Signed out (or switched accounts) while the request was in flight — the
    // result belongs to somebody else now and must not be applied.
    if (this.loadedFor !== forUid) return;
    if (error) {
      // Loading is best effort: without it the composer simply starts empty,
      // and the next keystroke still writes. Never surfaced as a hard error —
      // a draft that fails to load must not block writing feedback.
      this._loaded.set(true);
      return;
    }
    const next = new Map<string, DraftEntry>();
    for (const row of (data ?? []) as unknown as FeedbackDraftRow[]) {
      const draft = parseDraftRow(row);
      next.set(draft.scope, { ...draft, dirty: false, failed: false });
    }
    this._entries.set(next);
    this._loaded.set(true);
    this.importLegacyDrafts();
  }

  /** Drop everything in memory — a different account is signing in. */
  private reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.writes.clear();
    this.retries.clear();
    this._entries.set(new Map());
    this._loaded.set(false);
    this.loadPromise = null;
    this.loadedFor = null;
  }

  /**
   * One-time hand-over from the old localStorage drafts. A user who typed
   * something before this shipped keeps it; the key is then removed so the two
   * stores can never disagree afterwards.
   */
  private importLegacyDrafts(): void {
    if (typeof localStorage === 'undefined') return;
    for (const [key, scope] of LEGACY_KEYS) {
      try {
        const text = localStorage.getItem(key);
        if (text && text.trim() && !this._entries().get(scope)) {
          this.stage(scope, text, []);
        }
        if (text !== null) localStorage.removeItem(key);
      } catch {
        /* private mode / quota — nothing to import */
      }
    }
  }

  // ---- Reads -------------------------------------------------------------

  entry(scope: string): DraftEntry | null {
    return this._entries().get(scope) ?? null;
  }

  // ---- Writes ------------------------------------------------------------

  /**
   * Record what the composer currently holds. Cheap and synchronous — the
   * network write is debounced behind it, so this is safe to call on every
   * keystroke.
   */
  stage(scope: string, body: string, images: readonly DraftImageRef[]): void {
    if (!this.uid) return;
    const entry: DraftEntry = {
      scope,
      feedbackId: feedbackIdFromScope(scope),
      body,
      images: [...images],
      updatedAt: new Date().toISOString(),
      dirty: true,
      failed: false,
    };
    this.put(entry);
    this.retries.set(scope, 0);
    this.schedule(scope, SAVE_DEBOUNCE_MS);
  }

  private schedule(scope: string, delay: number): void {
    const existing = this.timers.get(scope);
    if (existing) clearTimeout(existing);
    this.timers.set(
      scope,
      setTimeout(() => {
        this.timers.delete(scope);
        void this.persist(scope);
      }, delay),
    );
  }

  /** Write the staged value now (composer blur, panel close, before send). */
  async flush(scope: string): Promise<void> {
    const timer = this.timers.get(scope);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(scope);
    }
    await this.persist(scope);
  }

  /**
   * Serialized per scope: a second call waits for the first, so the value that
   * lands last is always the value the user typed last.
   */
  private persist(scope: string): Promise<void> {
    const prev = this.writes.get(scope) ?? Promise.resolve();
    const next = prev.then(() => this.writeNow(scope)).catch(() => undefined);
    this.writes.set(scope, next);
    return next;
  }

  private async writeNow(scope: string): Promise<void> {
    const entry = this._entries().get(scope);
    const uid = this.uid;
    if (!entry || !entry.dirty || !uid) return;
    // Snapshot: anything typed while the request is in flight stays dirty and
    // is picked up by the next write instead of being marked clean here.
    const snapshot = { body: entry.body, images: entry.images };

    if (isEmptyDraft(snapshot.body, snapshot.images)) {
      const { error } = await this.sb.client
        .from('feedback_drafts')
        .delete()
        .eq('user_id', uid)
        .eq('scope', scope);
      if (error) return this.onWriteFailed(scope);
      this.drop(scope);
      return;
    }

    const { error } = await this.sb.client
      .from('feedback_drafts')
      .upsert(
        {
          user_id: uid,
          scope,
          feedback_id: entry.feedbackId,
          body: snapshot.body,
          images: snapshot.images,
        },
        { onConflict: 'user_id,scope' },
      );
    if (error) return this.onWriteFailed(scope);
    this.markClean(scope, snapshot);
  }

  private onWriteFailed(scope: string): void {
    const attempts = (this.retries.get(scope) ?? 0) + 1;
    this.retries.set(scope, attempts);
    const entry = this._entries().get(scope);
    if (entry) this.put({ ...entry, failed: true });
    // Keep trying for a while, then stop burning requests — the value stays in
    // memory and the next keystroke (or the pagehide flush) rearms the write.
    if (attempts <= MAX_RETRIES) this.schedule(scope, RETRY_DELAY_MS * attempts);
  }

  /**
   * The draft is on the server. Only clears `dirty` when the composer still
   * holds exactly what was written — otherwise the user typed on during the
   * request and the newer value must stay queued.
   */
  private markClean(scope: string, written: { body: string; images: DraftImageRef[] }): void {
    const entry = this._entries().get(scope);
    if (!entry) return;
    this.retries.set(scope, 0);
    const unchanged = entry.body === written.body && sameImages(entry.images, written.images);
    this.put({ ...entry, dirty: !unchanged, failed: false });
    if (!unchanged) this.schedule(scope, SAVE_DEBOUNCE_MS);
  }

  // ---- Removal -----------------------------------------------------------

  /**
   * The user pressed discard. The row goes, and so do the screenshots that were
   * uploaded for it — they were never part of a message, so nothing references
   * them afterwards.
   */
  async discard(scope: string): Promise<void> {
    const entry = this._entries().get(scope);
    this.cancel(scope);
    this.drop(scope);
    if (entry?.images.length) void this.removeUploads(entry.images);
    await this.deleteRow(scope);
  }

  /**
   * The message was sent. The row goes, the uploads stay: their URLs are now
   * part of the persisted message body.
   */
  async clearSent(scope: string): Promise<void> {
    this.cancel(scope);
    this.drop(scope);
    await this.deleteRow(scope);
  }

  private cancel(scope: string): void {
    const timer = this.timers.get(scope);
    if (timer) clearTimeout(timer);
    this.timers.delete(scope);
    this.retries.delete(scope);
  }

  private async deleteRow(scope: string): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    // Chained through the same per-scope queue so a delete can never overtake
    // an in-flight upsert and leave the row behind.
    const prev = this.writes.get(scope) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        // Discard is the one action the user expects to stick: a draft that
        // comes back after a reload reads as "it ignored me". Worth one retry.
        for (let attempt = 0; attempt < 2; attempt++) {
          const { error } = await this.sb.client
            .from('feedback_drafts')
            .delete()
            .eq('user_id', uid)
            .eq('scope', scope);
          if (!error) return;
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      })
      .catch(() => undefined);
    this.writes.set(scope, next);
    await next;
  }

  /** Best-effort cleanup of screenshots that never became a message. */
  private async removeUploads(images: readonly DraftImageRef[]): Promise<void> {
    const paths = images.map((img) => feedbackImagePath(img.url)).filter((p): p is string => !!p);
    if (paths.length === 0) return;
    try {
      await this.sb.client.storage.from(FEEDBACK_IMAGES_BUCKET).remove(paths);
    } catch {
      /* the object simply stays in the bucket — never worth failing a discard */
    }
  }

  // ---- Attachments -------------------------------------------------------

  /**
   * Upload one composer attachment so the draft can reference it.
   *
   * Done at attach time rather than at save time for two reasons: the draft row
   * stays a few hundred bytes (no base64 in the database), and sending later
   * reuses this very URL instead of uploading the same screenshot twice.
   * Returns null when the upload fails — the image then lives in the composer
   * only, is still sent normally, and just does not survive a reload.
   */
  async uploadAttachment(image: PendingImage): Promise<string | null> {
    const uid = this.uid;
    if (!uid) return null;
    try {
      const [url] = await uploadFeedbackImages(this.sb.client, uid, [image]);
      return url ?? null;
    } catch {
      return null;
    }
  }

  // ---- Unload flush ------------------------------------------------------

  /**
   * Write every dirty draft while the page is going away.
   *
   * `fetch(keepalive)` instead of the Supabase client: a normal request is
   * cancelled when the document is torn down, which is precisely the moment a
   * draft is most likely to be lost. Bodies here are a few KB — far below the
   * 64 KB keepalive budget.
   */
  flushBeacon(): void {
    const uid = this.uid;
    const token = this.auth.session()?.access_token;
    if (!uid || !token || typeof fetch === 'undefined') return;

    const rows = [...this._entries().values()]
      .filter((e) => e.dirty && !isEmptyDraft(e.body, e.images))
      .map((e) => ({
        user_id: uid,
        scope: e.scope,
        feedback_id: e.feedbackId,
        body: e.body,
        images: e.images,
      }));
    if (rows.length === 0) return;

    try {
      void fetch(
        `${environment.supabase.url}/rest/v1/feedback_drafts?on_conflict=user_id,scope`,
        {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            apikey: environment.supabase.publishableKey,
            Authorization: `Bearer ${token}`,
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify(rows),
        },
      );
    } catch {
      /* nothing left to do at this point in the page's life */
    }
  }

  // ---- Map helpers -------------------------------------------------------

  private put(entry: DraftEntry): void {
    const next = new Map(this._entries());
    next.set(entry.scope, entry);
    this._entries.set(next);
  }

  private drop(scope: string): void {
    if (!this._entries().has(scope)) return;
    const next = new Map(this._entries());
    next.delete(scope);
    this._entries.set(next);
  }
}

/** Two attachment lists are the same when the same URLs appear in the same order. */
function sameImages(a: readonly DraftImageRef[], b: readonly DraftImageRef[]): boolean {
  return a.length === b.length && a.every((img, i) => img.url === b[i].url);
}
