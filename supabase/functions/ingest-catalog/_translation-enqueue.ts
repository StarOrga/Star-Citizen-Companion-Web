// After a VERIFIED locale publish of a build: when translation is switched on,
// open one `translation_jobs` row per approved language (status `estimating`,
// idempotent per (build_id, lang)) and nudge translate-orchestrator.
// Contract: docs/translation/ARCHITECTURE.md. Never throws - a translation
// problem must not fail an ingest.

export interface EnqueueDb {
  /** translation_settings.enabled (singleton row). */
  isEnabled(): Promise<boolean>;
  /** Languages with approved = true. */
  approvedLangs(): Promise<string[]>;
  /** insert ... on conflict (build_id, lang) do nothing. */
  insertJobs(rows: { build_id: string; lang: string; status: 'estimating' }[]): Promise<void>;
}

export interface EnqueueResult {
  status: 'disabled' | 'unverified' | 'no_languages' | 'enqueued' | 'error';
  jobs: number;
  message?: string;
}

export async function enqueueTranslationJobs(
  db: EnqueueDb,
  buildId: string,
  publish: { lang: string; verified: boolean }[],
  tick: () => Promise<void>,
): Promise<EnqueueResult> {
  try {
    // Only a fully verified publish that includes the English source counts.
    if (publish.length === 0 || !publish.every((r) => r.verified) || !publish.some((r) => r.lang === 'en')) {
      return { status: 'unverified', jobs: 0 };
    }
    if (!(await db.isEnabled())) return { status: 'disabled', jobs: 0 };
    const published = new Set(publish.map((r) => r.lang));
    // Never enqueue a language this build did not publish at all.
    const langs = (await db.approvedLangs()).filter((l) => l !== 'en' && published.has(l));
    if (langs.length === 0) return { status: 'no_languages', jobs: 0 };
    await db.insertJobs(langs.map((lang) => ({ build_id: buildId, lang, status: 'estimating' as const })));
    await tick().catch((e) => console.error(`ingest-catalog: translate tick failed: ${(e as Error).message}`));
    return { status: 'enqueued', jobs: langs.length };
  } catch (e) {
    return { status: 'error', jobs: 0, message: (e as Error).message };
  }
}
