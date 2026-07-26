// ReadMe (readme.io) API client — **read-only**.
//
// The write half of this client was removed on purpose. The ReadMe project is
// Git-backed, and ReadMe refuses content-API access to Git-backed projects by
// design:
//
//   GET /v1/docs                    → 403  API_ACCESS_UNAVAILABLE
//   GET /v1/categories              → 403  API_ACCESS_UNAVAILABLE
//   GET /v2/branches                → 200  {"total":1,"data":[{"name":"1.0",…}]}
//   GET /v2/branches/1.0/guides     → 404  "The endpoint doesn't exist."
//   GET /v2/branches/1.0/categories → 404
//
// (verified against the live project on 2026-07-24 with the real key)
//
// So there is no code path that could publish a page, and keeping one around
// would only produce per-page 403s that look like a transient outage. Content
// is published through ReadMe's own Git Sync instead —
// see docs/readme-io/GIT-SYNC-SETUP.md.
//
// What survives is the diagnosis: enough read calls to answer "is the API
// still closed, and why", which is the one question worth asking the API.
//
//              v1                                  v2
//   base       https://dash.readme.com/api/v1      https://api.readme.com/v2
//   auth       Basic base64("<key>:")              Bearer <key>
//   grouping   versions (x-readme-version header)  branches (in the path)

const V2_BASE = 'https://api.readme.com/v2';
const V1_BASE = 'https://dash.readme.com/api/v1';

export type ApiVersion = 'v1' | 'v2';

export interface ReadmeResult<T> {
  ok: boolean;
  status: number;
  body: T | null;
  /** Raw text, kept only when the body was not JSON (error pages, HTML, …). */
  raw?: string;
}

/** How ReadMe is currently answering, and therefore how publishing works. */
export type AccessState =
  /** v1 answers 403 API_ACCESS_UNAVAILABLE — the project is Git-backed. Expected. */
  | 'git_backed'
  /** A content endpoint answered 200 — the API is open again, which is news. */
  | 'api_open'
  /** The key was rejected. */
  | 'unauthorized'
  /** Something else — see the raw statuses. */
  | 'unknown';

export class ReadmeApi {
  constructor(
    private readonly apiKey: string,
    readonly version: ApiVersion,
    /** v2: branch name in the path. v1: the `x-readme-version` header value. */
    readonly branch: string,
  ) {}

  private get base(): string {
    return this.version === 'v2' ? V2_BASE : V1_BASE;
  }

  private headers(): Record<string, string> {
    const auth =
      this.version === 'v2' ? `Bearer ${this.apiKey}` : `Basic ${btoa(`${this.apiKey}:`)}`;
    return {
      Authorization: auth,
      Accept: 'application/json',
      ...(this.version === 'v1' ? { 'x-readme-version': this.branch } : {}),
    };
  }

  /** GET only. There is deliberately no POST/PUT/PATCH/DELETE on this client. */
  async get<T>(path: string): Promise<ReadmeResult<T>> {
    const res = await fetch(`${this.base}${path}`, { method: 'GET', headers: this.headers() });
    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, body: text ? (JSON.parse(text) as T) : null };
    } catch {
      return { ok: res.ok, status: res.status, body: null, raw: text.slice(0, 600) };
    }
  }

  listBranches() {
    return this.get<unknown>('/branches');
  }

  listGuides() {
    return this.get<unknown>(
      this.version === 'v2' ? `/branches/${encodeURIComponent(this.branch)}/guides` : '/docs',
    );
  }

  listCategories() {
    return this.get<unknown>(
      this.version === 'v2'
        ? `/branches/${encodeURIComponent(this.branch)}/categories`
        : '/categories?perPage=100&page=1',
    );
  }
}

interface BranchListing {
  data?: Array<{ name?: unknown }>;
}

/** Pick the branch to report on: the caller's hint, else the first ReadMe lists, else `1.0`. */
export function pickBranch(body: unknown, hint?: string): string {
  if (hint) return hint;
  const listed = (body as BranchListing | null)?.data;
  const first = Array.isArray(listed) ? listed[0]?.name : undefined;
  return typeof first === 'string' && first ? first : '1.0';
}

/**
 * Classify what ReadMe is telling us.
 *
 * `git_backed` is the *expected* healthy state for this project — the 403 is
 * ReadMe enforcing that a Git-backed project is published from Git. It is only
 * a problem if you were expecting to publish over the API, which nothing does
 * any more.
 */
export function classify(
  v1Guides: ReadmeResult<unknown>,
  v2Guides: ReadmeResult<unknown>,
): AccessState {
  if (v1Guides.ok || v2Guides.ok) return 'api_open';
  if (v1Guides.status === 403 || v2Guides.status === 403) return 'git_backed';
  if (v1Guides.status === 401 || v2Guides.status === 401) return 'unauthorized';
  return 'unknown';
}
