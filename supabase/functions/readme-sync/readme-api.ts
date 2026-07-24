// ReadMe (readme.io) documentation API client — speaks **v2** and **v1**.
//
// Why both. v2 is the target API, but its *content* endpoints (guides,
// categories) are served only to projects migrated to "ReadMe Refactored".
// A project that has not migrated still answers `GET /v2/branches` with 200
// while every content path 404s — verified against this project on 2026-07-24:
//
//   GET /v2/branches               → 200  {"total":1,"data":[{"name":"1.0",…}]}
//   GET /v2/branches/1.0/guides    → 404  "The endpoint doesn't exist."
//   GET /v2/branches/1.0/categories→ 404  "The endpoint doesn't exist."
//   GET /v2/versions/1.0/guides    → 404      (and 5 further candidates, all 404)
//
// So the client probes for v2 content support and falls back to v1. The moment
// the project is migrated to Refactored, `detectApiVersion` picks v2 with no
// code change. Nothing about the authored markdown differs between the two.
//
//              v1                                  v2
//   base       https://dash.readme.com/api/v1      https://api.readme.com/v2
//   auth       Basic base64("<key>:")              Bearer <key>
//   grouping   versions (x-readme-version header)  branches (in the path)
//   list       GET  /categories                    GET   /branches/{b}/categories
//   read       GET  /docs/{slug}                   GET   /branches/{b}/guides/{slug}
//   create     POST /docs                          POST  /branches/{b}/guides
//   update     PUT  /docs/{slug}                   PATCH /branches/{b}/guides/{slug}
//   body field `body`                              `content.body`
//   category   `category` (hex id)                 `category.uri`

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

/** Version-neutral description of one page to publish. */
export interface PagePayload {
  slug: string;
  title: string;
  body: string;
  excerpt: string;
  position: number;
  /** v2: a category `uri`. v1: a category hex `_id`. */
  categoryRef: string;
}

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

  private headers(hasBody: boolean): Record<string, string> {
    const auth =
      this.version === 'v2'
        ? `Bearer ${this.apiKey}`
        : `Basic ${btoa(`${this.apiKey}:`)}`;
    return {
      Authorization: auth,
      Accept: 'application/json',
      ...(this.version === 'v1' ? { 'x-readme-version': this.branch } : {}),
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<ReadmeResult<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: this.headers(body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    try {
      return { ok: res.ok, status: res.status, body: text ? (JSON.parse(text) as T) : null };
    } catch {
      return { ok: res.ok, status: res.status, body: null, raw: text.slice(0, 600) };
    }
  }

  // --- reads ---------------------------------------------------------------

  listCategories() {
    return this.request<unknown>(
      'GET',
      this.version === 'v2'
        ? `/branches/${encodeURIComponent(this.branch)}/categories`
        : '/categories?perPage=100&page=1',
    );
  }

  listGuides() {
    return this.request<unknown>(
      'GET',
      this.version === 'v2' ? `/branches/${encodeURIComponent(this.branch)}/guides` : '/docs',
    );
  }

  getPage(slug: string) {
    return this.request<Row>(
      'GET',
      this.version === 'v2'
        ? `/branches/${encodeURIComponent(this.branch)}/guides/${encodeURIComponent(slug)}`
        : `/docs/${encodeURIComponent(slug)}`,
    );
  }

  categoryDocs(categorySlug: string) {
    // v1 only — used to discover a usable category when none matches by slug.
    return this.request<unknown>('GET', `/categories/${encodeURIComponent(categorySlug)}/docs`);
  }

  // --- writes --------------------------------------------------------------

  createPage(page: PagePayload) {
    return this.version === 'v2'
      ? this.request<Row>('POST', `/branches/${encodeURIComponent(this.branch)}/guides`, v2Body(page))
      : this.request<Row>('POST', '/docs', v1Body(page));
  }

  updatePage(page: PagePayload) {
    return this.version === 'v2'
      ? this.request<Row>(
          'PATCH',
          `/branches/${encodeURIComponent(this.branch)}/guides/${encodeURIComponent(page.slug)}`,
          v2Body(page),
        )
      : this.request<Row>('PUT', `/docs/${encodeURIComponent(page.slug)}`, v1Body(page));
  }

  createCategory(slug: string, title: string) {
    return this.version === 'v2'
      ? this.request<Row>('POST', `/branches/${encodeURIComponent(this.branch)}/categories`, {
          slug,
          title,
          type: 'guide',
        })
      : this.request<Row>('POST', '/categories', { title, type: 'guide' });
  }

  /** Read-only GET of an arbitrary path — used by the discovery sweep. */
  probePath(path: string) {
    return this.request<unknown>('GET', path);
  }
}

function v2Body(page: PagePayload) {
  return {
    title: page.title,
    slug: page.slug,
    type: 'basic',
    category: { uri: page.categoryRef },
    position: page.position,
    privacy: { view: 'public' },
    content: { body: page.body, ...(page.excerpt ? { excerpt: page.excerpt } : {}) },
    metadata: {
      title: page.title,
      ...(page.excerpt ? { description: page.excerpt } : {}),
    },
  };
}

function v1Body(page: PagePayload) {
  return {
    title: page.title,
    slug: page.slug,
    type: 'basic',
    category: page.categoryRef,
    body: page.body,
    excerpt: page.excerpt,
    order: page.position,
    hidden: false,
  };
}

/**
 * Decide which API this project actually serves.
 *
 * v2 is only usable when its *content* endpoints answer — `GET /v2/branches`
 * returning 200 is NOT sufficient, because an unmigrated project answers that
 * while 404-ing every guides/categories path. So the check is a content read.
 */
export async function detectApiVersion(
  apiKey: string,
  branch: string,
): Promise<{ version: ApiVersion; v2Branches: number; v2Guides: number }> {
  const v2 = new ReadmeApi(apiKey, 'v2', branch);
  const branches = await v2.probePath('/branches');
  const guides = await v2.listGuides();
  return {
    version: guides.ok ? 'v2' : 'v1',
    v2Branches: branches.status,
    v2Guides: guides.status,
  };
}

/**
 * Pull the branch/version identifier out of `GET /v2/branches`. Entries have
 * carried it as `name`, `slug` or the tail of `uri` across v2's iterations, so
 * probe all three rather than pinning one. Falls back to `1.0`, ReadMe's
 * default initial version.
 */
export function pickBranch(payload: unknown, preferred?: string): string {
  const rows = extractRows(payload);
  const names = rows
    .map((row) => firstString(row, ['name', 'slug', 'id']) ?? uriTail(row))
    .filter((n): n is string => !!n);

  if (preferred && (names.includes(preferred) || names.length === 0)) return preferred;

  const flagged = rows.find(
    (row) => row?.is_default === true || row?.default === true || row?.is_stable === true,
  );
  if (flagged) {
    const name = firstString(flagged, ['name', 'slug', 'id']) ?? uriTail(flagged);
    if (name) return name;
  }

  return names[0] ?? preferred ?? '1.0';
}

/**
 * Resolve a category slug to the reference the write endpoints want:
 * a `uri` on v2, the hex `_id` on v1.
 */
export function findCategoryRef(
  payload: unknown,
  slug: string,
  version: ApiVersion,
): string | null {
  for (const row of extractRows(payload)) {
    const rowSlug = firstString(row, ['slug', 'name']) ?? uriTail(row);
    if (!rowSlug || rowSlug.toLowerCase() !== slug.toLowerCase()) continue;
    const ref = version === 'v2' ? firstString(row, ['uri']) : firstString(row, ['_id', 'id']);
    if (ref) return ref;
  }
  return null;
}

/** First category in the listing, whatever its slug — a usable last resort. */
export function firstCategoryRef(payload: unknown, version: ApiVersion): string | null {
  for (const row of extractRows(payload)) {
    const ref = version === 'v2' ? firstString(row, ['uri']) : firstString(row, ['_id', 'id']);
    if (ref) return ref;
  }
  return null;
}

/** Reuse the category an existing page already sits in. */
export function anyPageCategoryRef(payload: unknown, version: ApiVersion): string | null {
  for (const row of extractRows(payload)) {
    if (version === 'v2') {
      const uri = row?.category?.uri;
      if (typeof uri === 'string' && uri) return uri;
    } else {
      const cat = row?.category;
      if (typeof cat === 'string' && cat) return cat;
      if (cat && typeof cat === 'object') {
        const id = firstString(cat as Row, ['_id', 'id']);
        if (id) return id;
      }
    }
  }
  return null;
}

// --- helpers ---------------------------------------------------------------

type Row = Record<string, any>;

/** v2 wraps collections in `{ data: [...] }`; v1 returns bare arrays. */
function extractRows(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload as Row[];
  const data = (payload as Row | null)?.data;
  if (Array.isArray(data)) return data as Row[];
  if (data && typeof data === 'object') return [data as Row];
  if (payload && typeof payload === 'object') return [payload as Row];
  return [];
}

function firstString(row: Row | null | undefined, keys: string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/** `/branches/1.0` → `1.0` */
function uriTail(row: Row | null | undefined): string | null {
  const uri = row?.uri;
  if (typeof uri !== 'string' || !uri) return null;
  return uri.split('/').filter(Boolean).pop() || null;
}
