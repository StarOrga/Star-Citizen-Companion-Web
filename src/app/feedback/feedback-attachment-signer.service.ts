import { logWarn } from '../core/log';
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { FEEDBACK_IMAGES_BUCKET, feedbackImagePath } from './feedback-images.util';

/** Lifetime of one signed attachment URL, in seconds. */
export const SIGNED_URL_TTL_S = 3600;
/** A signed URL with less than this left is re-signed before it runs out. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** A path that failed to sign is not asked for again before this has passed. */
const RETRY_AFTER_MS = 60 * 1000;

interface SignedEntry {
  readonly path: string | null;
  readonly signedUrl?: string | null;
  readonly error?: unknown;
}

/**
 * Signs `feedback-images` object paths for display (AUD-115/AUD-351).
 *
 * The bucket is private, so the public URL a body stores is only an identifier
 * (see `feedback-attachment-urls.ts`). Everything that SHOWS an attachment —
 * thumbnails, the lightbox, file links in the text flow, the annotation export —
 * asks this service for a signed URL instead.
 *
 * `request()` and `urlFor()` are called from template methods, i.e. during
 * change detection, so neither ever writes a signal synchronously: all paths
 * asked for in one tick are batched into a single `createSignedUrls` call that
 * runs in a microtask, and its result lands in the `signed` signal, which
 * re-renders the OnPush views that read it.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackAttachmentSignerService {
  private readonly sb = inject(SupabaseClientProvider);

  /** Object path → signed URL. Replaced by a NEW map on every change. */
  readonly signed = signal<ReadonlyMap<string, string>>(new Map());
  private readonly failedPaths = signal<ReadonlySet<string>>(new Set());

  private readonly expiresAt = new Map<string, number>();
  private readonly failedAt = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private readonly queued = new Set<string>();
  private scheduled = false;

  /** Ask for signed URLs for these object paths (batched, deduplicated). */
  request(paths: readonly string[]): void {
    const now = Date.now();
    for (const p of paths) {
      if (p && this.needsSigning(p, now)) this.queued.add(p);
    }
    if (this.queued.size > 0 && !this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => void this.flush());
    }
  }

  /**
   * The URL to display for an attachment source. A `data:` URI or a foreign
   * https address is returned unchanged; a bucket URL maps to its signed URL,
   * or `null` while it is still being signed or when signing failed.
   */
  urlFor(src: string): string | null {
    const path = feedbackImagePath(src);
    if (!path) return src;
    const url = this.signed().get(path) ?? null;
    const exp = this.expiresAt.get(path);
    const now = Date.now();
    if (!url || exp === undefined || exp - now <= REFRESH_MARGIN_MS) this.request([path]);
    if (url && exp !== undefined && exp > now) return url;
    return null;
  }

  /** True when signing this source's object path has failed. */
  failed(src: string): boolean {
    const path = feedbackImagePath(src);
    return !!path && this.failedPaths().has(path);
  }

  private needsSigning(path: string, now: number): boolean {
    if (this.inFlight.has(path) || this.queued.has(path)) return false;
    const exp = this.expiresAt.get(path);
    if (exp !== undefined && exp - now > REFRESH_MARGIN_MS) return false;
    const failed = this.failedAt.get(path);
    if (failed !== undefined && now - failed < RETRY_AFTER_MS) return false;
    return true;
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    const paths = [...this.queued];
    this.queued.clear();
    if (paths.length === 0) return;
    for (const p of paths) this.inFlight.add(p);
    const requestedAt = Date.now();
    try {
      const { data, error } = await this.sb.client.storage
        .from(FEEDBACK_IMAGES_BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL_S);
      if (error || !Array.isArray(data)) {
        this.markFailed(paths, error ?? 'no data');
        return;
      }
      const entries = data as readonly SignedEntry[];
      const next = new Map(this.signed());
      const ok: string[] = [];
      const bad: string[] = [];
      paths.forEach((p, i) => {
        const entry = entries.find((e) => e.path === p) ?? entries[i];
        if (entry && !entry.error && entry.signedUrl) {
          next.set(p, entry.signedUrl);
          this.expiresAt.set(p, requestedAt + SIGNED_URL_TTL_S * 1000);
          this.failedAt.delete(p);
          ok.push(p);
        } else {
          bad.push(p);
        }
      });
      if (ok.length > 0) {
        this.signed.set(next);
        this.clearFailed(ok);
      }
      if (bad.length > 0) this.markFailed(bad, 'object not signed');
    } catch (err) {
      this.markFailed(paths, err);
    } finally {
      for (const p of paths) this.inFlight.delete(p);
    }
  }

  private markFailed(paths: readonly string[], reason: unknown): void {
    const now = Date.now();
    const set = new Set(this.failedPaths());
    for (const p of paths) {
      this.failedAt.set(p, now);
      set.add(p);
    }
    this.failedPaths.set(set);
    logWarn('feedback-attachments', 'sign failed', { paths: paths.length, reason });
  }

  private clearFailed(paths: readonly string[]): void {
    const current = this.failedPaths();
    if (!paths.some((p) => current.has(p))) return;
    const set = new Set(current);
    for (const p of paths) set.delete(p);
    this.failedPaths.set(set);
  }
}
