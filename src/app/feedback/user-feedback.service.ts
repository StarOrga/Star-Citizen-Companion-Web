import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import type { ComposerPayload } from '../admin/feedback/feedback-composer.component';
import { buildFeedbackBody, uploadFeedbackImages } from './feedback-images.util';
import {
  AuthorFeedbackMessage,
  AuthorFeedbackRow,
  AuthorThreadMap,
  FeedbackReadState,
  FeedbackReadStateMap,
  groupAuthorMessages,
  topicsWithNews,
} from './user-feedback.types';

/**
 * The non-admin half of the feedback system (feedback 5920cf8c).
 *
 * Every read goes through `public.my_feedback` — the restricted view that
 * projects only author-safe columns and hard-filters on `author_id =
 * auth.uid()`. This service must never touch `admin_feedback` or
 * `admin_feedback_messages` directly: the first would expose the routine's
 * internal notes, the second is the admin <-> Claude conversation and is
 * categorically off limits to non-admins (the database refuses either way, but
 * keeping the client honest makes the boundary readable).
 */
@Injectable({ providedIn: 'root' })
export class UserFeedbackService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly imp = inject(ImpersonationService);

  private readonly _topics = signal<AuthorFeedbackRow[]>([]);
  private readonly _threads = signal<AuthorThreadMap>(new Map());
  private readonly _readState = signal<FeedbackReadStateMap>(new Map());
  private readonly _newsSinceOpen = signal<ReadonlySet<string>>(new Set());
  private readonly _busy = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _loaded = signal(false);

  /** The caller's own topics, newest first. */
  readonly topics = this._topics.asReadonly();
  /** Author-visible messages per topic, oldest first. */
  readonly threads = this._threads.asReadonly();
  readonly busy = this._busy.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** How many topics are waiting on an answer from this user. */
  readonly openQuestions = computed(
    () => this._topics().filter((t) => t.author_status === 'question').length,
  );

  /**
   * Topics with news the author has not seen yet — a reply from the team or a
   * status change since they last had the panel open. This is the FAB badge
   * (admin feedback e684c946).
   */
  readonly unreadTopics = computed(
    () => topicsWithNews(this._topics(), this._threads(), this._readState()).length,
  );

  /**
   * What was unread at the moment the panel was opened, kept for this session
   * only. Marking everything read is what makes the badge go away, so without
   * this snapshot the user would be told "3 news" and then handed a list with
   * nothing highlighted. Cleared on sign-out, never persisted.
   */
  readonly newsSinceOpen = this._newsSinceOpen.asReadonly();

  private get uid(): string | null {
    return this.auth.user()?.id ?? null;
  }

  clearError(): void {
    this._error.set(null);
  }

  /** Reload the caller's topics and their author-visible threads. */
  async refresh(): Promise<void> {
    if (!this.uid) {
      this._topics.set([]);
      this._threads.set(new Map());
      this._readState.set(new Map());
      this._newsSinceOpen.set(new Set());
      return;
    }
    this._busy.set(true);
    this._error.set(null);
    const { data, error } = await this.sb.client
      .from('my_feedback')
      .select('id, body, created_at, updated_at, decision_note, author_status, area')
      .order('created_at', { ascending: false });
    if (error) {
      this._error.set(error.message);
      this._busy.set(false);
      return;
    }
    const rows = (data ?? []) as unknown as AuthorFeedbackRow[];
    this._topics.set(rows);
    await Promise.all([this.loadThreads(rows.map((r) => r.id)), this.loadReadState()]);
    this._loaded.set(true);
    this._busy.set(false);
  }

  /** Fetch every topic's author-visible replies in one query, grouped by topic. */
  private async loadThreads(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      this._threads.set(new Map());
      return;
    }
    const { data, error } = await this.sb.client
      .from('feedback_author_messages')
      .select('id, feedback_id, author_id, from_admin, is_question, body, created_at')
      .in('feedback_id', ids)
      .order('created_at', { ascending: true });
    // Threads are additive — a load failure must not blank the topic list.
    if (error) return;
    this._threads.set(groupAuthorMessages((data ?? []) as unknown as AuthorFeedbackMessage[]));
  }

  /**
   * Load this account's read markers. Scoped by RLS to `user_id = auth.uid()`,
   * so no filter is needed here — and like the threads, a failure is swallowed:
   * without markers everything simply reads as news, which is the safe direction
   * (a badge too many, never a missed reply).
   */
  private async loadReadState(): Promise<void> {
    const { data, error } = await this.sb.client
      .from('feedback_read_state')
      .select('feedback_id, last_read_at, last_seen_status');
    if (error) return;
    const rows = (data ?? []) as unknown as FeedbackReadState[];
    this._readState.set(new Map(rows.map((r) => [r.feedback_id, r])));
  }

  messagesFor(id: string): AuthorFeedbackMessage[] {
    return this._threads().get(id) ?? [];
  }

  /** True while this topic is one of the ones the panel was opened for. */
  hasNewsSinceOpen(id: string): boolean {
    return this._newsSinceOpen().has(id);
  }

  /**
   * The author is looking at their topics — clear the badge (admin feedback
   * e684c946). One upsert per topic that actually has news; a quiet panel writes
   * nothing at all.
   *
   * `last_seen_status` is the status the panel is showing right now, which is
   * the honest answer to "what did you see". The server overwrites
   * `last_read_at` with its own clock (see the guard in the migration), so the
   * written rows are read back from the upsert instead of being guessed locally.
   */
  async markAllRead(): Promise<void> {
    const uid = this.uid;
    if (!uid) return;
    // A role preview writes under the admin's REAL identity (the JWT is
    // untouched), so it would silently mark the admin's own topics read. Skipped
    // rather than refused: this is a passive side effect of opening the panel,
    // and an error banner for it would be noise.
    if (this.imp.activeOrPending()) return;
    if (!this._loaded()) await this.refresh();

    const news = topicsWithNews(this._topics(), this._threads(), this._readState());
    this._newsSinceOpen.set(new Set(news));
    await this.writeReadState(news);
  }

  /**
   * Persist "seen" for the given topics. Split out of {@link markAllRead} so the
   * reply path can use it without disturbing the highlight snapshot: answering a
   * question flips the topic back to "in Bearbeitung" server-side, which would
   * otherwise count as news the second the user closes the panel they are
   * looking at right now.
   */
  private async writeReadState(ids: readonly string[]): Promise<void> {
    const uid = this.uid;
    if (!uid || ids.length === 0) return;

    const statuses = new Map(this._topics().map((t) => [t.id, t.author_status]));
    const payload = ids.map((id) => ({
      user_id: uid,
      feedback_id: id,
      last_seen_status: statuses.get(id) ?? 'in_progress',
    }));
    const { data, error } = await this.sb.client
      .from('feedback_read_state')
      .upsert(payload, { onConflict: 'user_id,feedback_id' })
      .select('feedback_id, last_read_at, last_seen_status');
    // Read markers are a convenience, not content: a failed write must never
    // surface as an error over the panel the user just opened. The badge simply
    // stays up and the next open tries again.
    if (error) return;
    const written = (data ?? []) as unknown as FeedbackReadState[];
    const merged = new Map(this._readState());
    for (const row of written) merged.set(row.feedback_id, row);
    this._readState.set(merged);
  }

  /**
   * A role preview is presentation-only: the Supabase JWT stays the real one,
   * so an admin previewing as viewer/collaborator sees this panel (that is the
   * point) but a send would file genuine feedback under their own account,
   * straight into the admin inbox. Both write paths refuse here — the single
   * choke point, rather than trying to intercept the composer's buttons and
   * key bindings from the outside.
   */
  private blockedByPreview(): boolean {
    if (!this.imp.activeOrPending()) return false;
    this._error.set('preview');
    return true;
  }

  /**
   * File a new feedback topic. It enters the admins' board as `source='user'`,
   * `status='open'` and `triaged=false` — untriaged so an admin reads it before
   * the autonomous routine may implement and ship it. Those three values are
   * also pinned by the insert policy, so they are not a client-side courtesy.
   *
   * Returns true once persisted, which is what clears the composer.
   */
  async submit(payload: ComposerPayload): Promise<boolean> {
    const uid = this.uid;
    if (!uid) return false;
    if (this.blockedByPreview()) return false;
    this._error.set(null);
    let body: string;
    try {
      const urls = await uploadFeedbackImages(this.sb.client, uid, payload.images);
      body = buildFeedbackBody(payload.text, payload.images, urls);
    } catch {
      this._error.set('upload');
      return false;
    }
    if (!body) return false;
    const { error } = await this.sb.client.from('admin_feedback').insert({
      body,
      author_id: uid,
      source: 'user',
      status: 'open',
      triaged: false,
      // Which part of the app this is about (admin feedback 835fec58). The
      // composer pre-selects it from the current route, so the common case is
      // "the sender confirmed our guess by not touching it". Nullable on
      // purpose — the CHECK constraint rejects anything outside the vocabulary
      // rather than letting a crafted request write free text onto the board.
      area: payload.area ?? null,
    });
    if (error) {
      // 54000 = the per-author hourly topic cap raised by the DB guard. Worth its
      // own message: "rate limit reached" is actionable, a raw SQL error is not.
      this._error.set(error.code === '54000' ? 'rate' : error.message);
      return false;
    }
    await this.refresh();
    return true;
  }

  /**
   * Answer an admin's question in the author-visible channel of one topic. Only
   * possible while that question is open — the database gates the insert on
   * `status = 'needs_input_author'`, which is exactly when the panel offers the
   * box. Once the answer lands, the topic silently goes back to "in Bearbeitung"
   * (the status the admin's question interrupted is restored server-side).
   */
  async reply(feedbackId: string, payload: ComposerPayload): Promise<boolean> {
    const uid = this.uid;
    if (!uid) return false;
    if (this.blockedByPreview()) return false;
    this._error.set(null);
    let body: string;
    try {
      const urls = await uploadFeedbackImages(this.sb.client, uid, payload.images);
      body = buildFeedbackBody(payload.text, payload.images, urls);
    } catch {
      this._error.set('upload');
      return false;
    }
    if (!body) return false;
    const { error } = await this.sb.client.from('feedback_author_messages').insert({
      feedback_id: feedbackId,
      author_id: uid,
      from_admin: false,
      is_question: false,
      body,
    });
    if (error) {
      this._error.set(error.message);
      return false;
    }
    await this.refresh();
    // Answering closes the question, so the topic drops back to "in Bearbeitung"
    // — a status change the author caused and is currently looking at. Without
    // this it would come back as unread news the moment they close the panel.
    await this.writeReadState([feedbackId]);
    return true;
  }
}
