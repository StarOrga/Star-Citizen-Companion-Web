import { Provider, signal } from '@angular/core';
import { FeedbackAttachmentSignerService } from '../feedback-attachment-signer.service';
import { feedbackImagePath } from '../feedback-images.util';

/**
 * Test double for the attachment signer — Karma must never sign against the
 * real Storage API. By default every source passes through unchanged; give it
 * `signed` (object path → URL) to make bucket URLs resolve like the real one,
 * and `failed` paths to simulate a signing error.
 */
export class FakeAttachmentSigner {
  readonly signed = signal<ReadonlyMap<string, string>>(new Map());
  readonly requested: string[] = [];

  constructor(
    private readonly map: ReadonlyMap<string, string> | null = null,
    private readonly failedPaths: ReadonlySet<string> = new Set(),
  ) {
    if (map) this.signed.set(map);
  }

  request(paths: readonly string[]): void {
    this.requested.push(...paths);
  }

  urlFor(src: string): string | null {
    if (!this.map) return src;
    const path = feedbackImagePath(src);
    if (!path) return src;
    return this.map.get(path) ?? null;
  }

  failed(src: string): boolean {
    const path = feedbackImagePath(src);
    return !!path && this.failedPaths.has(path);
  }
}

export function provideFakeAttachmentSigner(fake: FakeAttachmentSigner = new FakeAttachmentSigner()): Provider {
  return { provide: FeedbackAttachmentSignerService, useValue: fake };
}
