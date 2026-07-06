import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

/** One changelog bullet: an optional bold headline plus its description. */
export interface ReleaseNoteItem {
  title: string;
  text: string;
}

/** A "### Added" / "### Fixed — News feeds" group within a release. */
export interface ReleaseNoteSection {
  /** Leading category token, e.g. "Added", "Changed", "Migrations / infra". */
  category: string;
  /** Optional descriptive remainder after the em-dash ("" if none). */
  label: string;
  items: ReleaseNoteItem[];
}

export interface Release {
  version: string;
  date: string;
  sections: ReleaseNoteSection[];
}

export interface ReleaseNotes {
  generatedFrom: string;
  current: string | null;
  releases: Release[];
}

/**
 * Loads the build-time-generated `/release-notes.json` (produced from
 * CHANGELOG.md by `scripts/gen-release-notes.js`). Cached after the first
 * successful fetch so the footer and the What's-New page share one request.
 */
@Injectable({ providedIn: 'root' })
export class ReleaseNotesService {
  private readonly http = inject(HttpClient);

  readonly notes = signal<ReleaseNotes | null>(null);
  private inflight: Promise<ReleaseNotes | null> | null = null;

  /** Fetch once; subsequent calls resolve from cache. Never throws. */
  async load(): Promise<ReleaseNotes | null> {
    if (this.notes()) return this.notes();
    if (this.inflight) return this.inflight;
    this.inflight = firstValueFrom(this.http.get<ReleaseNotes>('release-notes.json'))
      .then((data) => {
        this.notes.set(data);
        return data;
      })
      .catch(() => null)
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
