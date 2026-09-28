// Secret resolution for ingest-telemetry (AUD-114) — pure, so it runs under
// `node --test` and `deno test` alike. Deno.env stays in index.ts; the env is
// passed in as a getter.
//
// There is NO silent fallback: a deploy without TELEMETRY_HMAC_KEY would
// otherwise accept events signed with the public dev key that sits in every
// open-source client build, and without TELEMETRY_HASH_SALT every install /
// session / IP hash would be computed with a public salt. Only a local stack
// may opt into the dev literals, explicitly, with TELEMETRY_DEV=1.

export const DEV_HMAC_KEY = 'scc-telemetry-dev-key-v1';
export const DEV_HASH_SALT = 'scc-telemetry-salt-v1';

export type TelemetrySecrets =
  | { ok: true; hmacKey: string; hashSalt: string; dev: boolean }
  | { ok: false; missing: string[] };

export function resolveTelemetrySecrets(get: (name: string) => string | undefined): TelemetrySecrets {
  const hmacKey = (get('TELEMETRY_HMAC_KEY') ?? '').trim();
  const hashSalt = (get('TELEMETRY_HASH_SALT') ?? '').trim();
  if (hmacKey && hashSalt) return { ok: true, hmacKey, hashSalt, dev: false };

  if ((get('TELEMETRY_DEV') ?? '').trim() === '1') {
    return {
      ok: true,
      hmacKey: hmacKey || DEV_HMAC_KEY,
      hashSalt: hashSalt || DEV_HASH_SALT,
      dev: true,
    };
  }

  const missing: string[] = [];
  if (!hmacKey) missing.push('TELEMETRY_HMAC_KEY');
  if (!hashSalt) missing.push('TELEMETRY_HASH_SALT');
  return { ok: false, missing };
}
