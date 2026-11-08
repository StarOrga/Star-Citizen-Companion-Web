// Pure parsing of the GitHub `scc-app-latest` alias release (runs under Deno and plain Node).

export interface SccReleaseMeta {
  version: string | null;
  sizeBytes: number | null;
}

/** The alias body reads "... (currently `v0.100.0`)"; the .exe asset carries the size. */
export function parseSccRelease(json: unknown): SccReleaseMeta {
  const j = (json && typeof json === 'object' ? json : {}) as {
    body?: unknown;
    assets?: unknown;
  };
  const body = typeof j.body === 'string' ? j.body : '';
  const version = /currently\s+`(v\d+\.\d+\.\d+[^`]*)`/.exec(body)?.[1] ?? null;
  const assets: unknown[] = Array.isArray(j.assets) ? j.assets : [];
  const exe = assets.find(
    (a): a is { name: string; size: number } => {
      const o = a as { name?: unknown; size?: unknown } | null;
      return !!o && typeof o.name === 'string' && o.name.endsWith('.exe') && typeof o.size === 'number' && o.size > 0;
    },
  );
  return { version, sizeBytes: exe?.size ?? null };
}
