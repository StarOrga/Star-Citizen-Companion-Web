import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from '../auth/auth.service';
import type { ComposerPayload } from '../admin/feedback/feedback-composer.component';
import { buildFeedbackBody, uploadFeedbackImages } from './feedback-images.util';
import {
  AuthorFeedbackMessage,
  AuthorFeedbackRow,
  AuthorThreadMap,
  groupAuthorMessages,
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

  private readonly _topics = signal<AuthorFeedbackRow[]>([]);
  private readonly _threads = signal<AuthorThreadMap>(new Map());
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

  /** How many topics are waiting on an answer from this user — drives the FAB badge. */
  readonly openQuestions = computed(
    () => this._topics().filter((t) => t.author_status === 'question').length,
  );

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
      return;
    }
    this._busy.set(true);
    this._error.set(null);
    const { data, error } = await this.sb.client
      .from('my_feedback')
      .select('id, body, created_at, updated_at, decision_note, author_status')
      .order('created_at', { ascending: false });
    if (error) {
      this._error.set(error.message);
      this._busy.set(false);
      return;
    }
    const rows = (data ?? []) as unknown as AuthorFeedbackRow[];
    this._topics.set(rows);
    await this.loadThreads(rows.map((r) => r.id));
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

  messagesFor(id: string): AuthorFeedbackMessage[] {
    return this._threads().get(id) ?? [];
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
    return true;
  }
}
