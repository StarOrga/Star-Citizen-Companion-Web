// supabase/functions/ingest-skins
// ---------------------------------------------------------------
// Ship-skin (3D livery) ingest from the desktop data-uploader. Same auth shape
// as ingest-bundle (user JWT + release-token + admin/collaborator role), but
// the heavy glb/webp assets never travel through this function: we hand the
// client short-lived *signed upload URLs* so it PUTs each object straight into
// the public `ship-skins` bucket. The desktop binary therefore needs NO
// service-role secret — the service role lives only here, server-side.
//
// Two actions:
//   POST { action:'sign',   ship_id, objects:[{skin_id, ext:'glb'|'webp', sha256?}] }
//        -> 200 { uploads:[{path, token, signedUrl, exists?}] }
//   POST { action:'commit', ship_id, skins:[{skin_id, name, description?,
//          source?, name_verified?, has_model, has_icon, model_bytes?, sort?,
//          model_sha256?}] }
//        -> 200 { ok:true, count }
//
// Object paths are ALWAYS derived server-side from validated ids
// (`<ship_id>/<skin_id>.<ext>`) — the client never supplies a storage path,
// so a malicious client can't traverse the bucket.
//
// SHARED HULLS (R2 mode, see _hulls.ts): a glb sent with its lowercase hex
// `sha256` lives once at `_hulls/<sha256>.glb`, shared by every variant with
// the same bytes. Sign answers `exists: true` (no URL) when that object is
// already there, so it is never overwritten; commit refuses a hashed model
// whose object is missing (409 hull_missing), and reads back + hashes a
// shared hull no row references yet (= uploaded by this upload): over
// MAX_HULL_BYTES or a SHA-256 that differs from its path, the object is
// deleted and the commit refused (409 hull_too_large | hull_hash_mismatch).
// Prune only touches `<ship_id>/`;
// a shared hull this ship stopped using is deleted only once no ship_skins row
// references it. Without `sha256` (older uploaders) or without R2, the
// per-ship path stays — both shapes coexist during the transition.
//
// A commit REPLACES the ship: rows and objects it no longer lists are removed.
// That is how the textured one-glb-per-skin export leaves the public bucket —
// since uploader 0.37.0 a ship is one geometry-only hull glb plus store icons,
// and CIG's texture art must not stay downloadable (RSI Fankit & Fandom FAQ).
// For the same reason a glb is only signed for an uploader of that version or
// newer: an older binary would publish textured hulls again.
//
//   400 invalid_json | invalid_body | unsafe_id
//   409 hull_missing | hull_hash_mismatch | hull_too_large (shared hull not
//       committable; a fresh object that failed the check is deleted)
//   401 unauthorized
//   403 forbidden | unknown_release_token | release_token_revoked
//   426 uploader_outdated
//   500 server_misconfigured | sign_failed | commit_failed | prune_failed
//   503 r2_usage_unknown (R2 mode only: usage could not be read — fail closed;
//       a reading up to 24 h old (same month) bridges an Analytics outage)
//   507 storage_quota_exceeded | r2_free_tier_guard (R2 mode only)
//
// STORAGE BACKEND (storage plan 2026-09-24): with the R2_* secrets set (see
// _r2.ts) objects go to Cloudflare R2 under `ship-skins/<ship>/<skin>.<ext>`
// and are served by cloudflare/assets-worker; without them, to the Supabase
// `ship-skins` bucket as before. The response shape is identical either way
// (`signedUrl` is absolute for R2, `token` empty), so the uploader does not
// care. An R2 commit also removes that ship's leftover Supabase objects: the
// hull now lives in R2, and the Supabase copy only costs Free-plan storage.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  SKINS_PREFIX,
  bucketBytes,
  deleteObject,
  getObject,
  listObjects,
  presignPut,
  r2FromEnv,
  readUsage,
} from './_r2.ts';
import { usageGate } from './_r2-usage.ts';
import {
  MAX_HULL_BYTES,
  checkHull,
  droppedHulls,
  hullSha,
  isHullPath,
  isReservedShipId,
  modelPathFor,
  needsVerification,
} from './_hulls.ts';
import {
  CLASS_NAME,
  MAX_BYTES,
  MAX_OBJECTS_PER_SIGN,
  MIN_PACKAGE_TOOL_VERSION,
  checkManifestBytes,
  isPackageKind,
  packagePath,
  parseObject,
} from './_packages.ts';
import type { ManifestRefs, ObjectOk } from './_packages.ts';

const BUCKET = 'ship-skins';
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const ALLOWED_SOURCES = new Set(['store', 'event', 'subscriber', 'factory', 'pu_npc']);
/** First uploader whose hull glb is geometry-only. */
const MIN_GLB_TOOL_VERSION = [0, 37, 0];

/** `a.b.c` (any suffix ignored) at or above `min`; unparsable → false. */
export function toolVersionAtLeast(version: string | null, min: number[]): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec((version ?? '').trim());
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3])];
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] > min[i];
  }
  return true;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-sc-release-token, x-sc-tool-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

interface SkinRowIn {
  skin_id?: string;
  name?: string;
  description?: string;
  source?: string;
  name_verified?: boolean;
  has_model?: boolean;
  has_icon?: boolean;
  model_bytes?: number;
  sort?: number;
  model_sha256?: string;
}

interface Body {
  action?: 'sign' | 'commit' | 'package_sign' | 'package_commit';
  ship_id?: string;
  objects?: { skin_id?: string; ext?: string; sha256?: string }[];
  skins?: SkinRowIn[];
}

type R2 = NonNullable<ReturnType<typeof r2FromEnv>>;

/**
 * Cost kill-switch: no signature once this month's account-wide usage reaches
 * 80 % of any free allowance, or while usage cannot be read. A reading up to
 * 24 h old from the same month bridges an Analytics outage (usageGate); without
 * one it stays fail-closed. Also refuses past the bucket quota. null = go on.
 */
async function r2Gate(r2: R2): Promise<Response | null> {
  const { reading, error } = await readUsage(r2);
  const gate = usageGate(reading, error, Date.now());
  if (gate.kind === 'unknown') return json({ error: 'r2_usage_unknown', message: gate.reason }, 503);
  if (gate.stale && reading) {
    console.warn(
      `ingest-skins: analytics unreadable (${error}); deciding on a reading ${Math.round((Date.now() - reading.at) / 60000)} min old`,
    );
  }
  if (gate.kind === 'over') {
    return json({ error: 'r2_free_tier_guard', message: `R2 usage near the free tier: ${gate.over}` }, 507);
  }
  let used: number;
  try {
    used = await bucketBytes(r2);
  } catch (e) {
    return json({ error: 'sign_failed', message: (e as Error).message }, 500);
  }
  if (used >= r2.quotaBytes) {
    return json({ error: 'storage_quota_exceeded', message: `R2 holds ${used} of ${r2.quotaBytes} bytes` }, 507);
  }
  return null;
}

/** Runs `fn` over `items` with at most `n` in flight; results keep the input order. */
async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Stored size of one object below `ship-skins/`, or null when it is not there. */
async function sizeOf(r2: R2, path: string): Promise<number | null> {
  const key = SKINS_PREFIX + path;
  return (await listObjects(r2, key)).find((x) => x.key === key)?.size ?? null;
}

interface PackageBody {
  action?: string;
  kind?: unknown;
  entity_class?: unknown;
  ship_id?: unknown;
  manifest_sha256?: unknown;
  objects?: { type?: unknown; sha256?: unknown; bytes?: unknown }[];
}

/**
 * Package actions (data-uploader/docs/asset-package.md):
 *   package_sign   { kind, entity_class, manifest_sha256, objects:[{type, sha256, bytes}] }
 *                  -> { ok, unchanged:true }   the row already names this manifest
 *                  -> { ok, uploads:[{type, sha256, path, signedUrl, exists?}] }
 *   package_commit { kind, entity_class, manifest_sha256, ship_id? }
 *                  -> { ok, entity_class, part_count, total_bytes }
 * R2 only: packages have no Supabase-bucket fallback. Commit re-reads the
 * manifest, checks its hash, derives every row field from it and verifies each
 * object it names is stored at the declared size.
 */
async function handlePackage(
  body: PackageBody,
  adminClient: ReturnType<typeof createClient>,
  uploaderVersion: string,
): Promise<Response> {
  const r2 = r2FromEnv((k) => Deno.env.get(k));
  if (!r2) return json({ error: 'r2_required', message: 'asset packages need R2' }, 501);
  if (!toolVersionAtLeast(uploaderVersion, MIN_PACKAGE_TOOL_VERSION)) {
    return json(
      { error: 'uploader_outdated', message: `3D packages need uploader ${MIN_PACKAGE_TOOL_VERSION.join('.')} or newer` },
      426,
    );
  }
  const kind = body.kind;
  if (!isPackageKind(kind)) return json({ error: 'invalid_body', message: 'kind must be ship|fps_weapon' }, 400);
  const entityClass = typeof body.entity_class === 'string' ? body.entity_class.trim() : '';
  if (!CLASS_NAME.test(entityClass)) {
    return json({ error: 'unsafe_id', message: 'entity_class is not a safe class name' }, 400);
  }
  const manifestSha = hullSha(body.manifest_sha256);
  if (!manifestSha) return json({ error: 'invalid_body', message: 'manifest_sha256 must be lowercase hex sha256' }, 400);

  const { data: current, error: curErr } = await adminClient
    .from('asset_packages')
    .select('manifest_sha256')
    .eq('kind', kind)
    .eq('entity_class', entityClass)
    .maybeSingle();
  if (curErr) return json({ error: 'sign_failed', message: curErr.message }, 500);
  const unchanged = (current as { manifest_sha256?: string } | null)?.manifest_sha256 === manifestSha;

  if (body.action === 'package_sign') {
    if (unchanged) return json({ ok: true, unchanged: true });
    const objects = Array.isArray(body.objects) ? body.objects : [];
    if (!objects.length || objects.length > MAX_OBJECTS_PER_SIGN) {
      return json({ error: 'invalid_body', message: `objects must hold 1-${MAX_OBJECTS_PER_SIGN} entries` }, 400);
    }
    const parsed: ObjectOk[] = [];
    for (const o of objects) {
      const p = parseObject(o);
      if (typeof p === 'string') return json({ error: 'invalid_body', message: p }, 400);
      parsed.push(p);
    }
    const unique = [...new Map(parsed.map((p) => [p.path, p])).values()];
    const refused = await r2Gate(r2);
    if (refused) return refused;
    try {
      const uploads = await mapLimit(unique, 8, async (o) => {
        const base = { type: o.type, sha256: o.sha, path: o.path };
        if ((await sizeOf(r2, o.path)) !== null) return { ...base, signedUrl: '', exists: true };
        return { ...base, signedUrl: await presignPut(r2, SKINS_PREFIX + o.path) };
      });
      return json({ ok: true, uploads });
    } catch (e) {
      return json({ error: 'sign_failed', message: (e as Error).message }, 500);
    }
  }

  // ---- package_commit ----
  const shipId = typeof body.ship_id === 'string' ? body.ship_id.trim() : '';
  if (shipId && (!SAFE_ID.test(shipId) || isReservedShipId(shipId))) {
    return json({ error: 'unsafe_id', message: 'ship_id is not a safe id' }, 400);
  }
  const manifestPath = packagePath('manifest', manifestSha);
  const manifestKey = SKINS_PREFIX + manifestPath;
  let refs: ManifestRefs;
  let manifestBytes: number;
  try {
    if ((await sizeOf(r2, manifestPath)) === null) return json({ error: 'manifest_missing', message: manifestPath }, 409);
    const bytes = await getObject(r2, manifestKey, MAX_BYTES.manifest);
    const check = await checkManifestBytes(bytes, manifestSha, kind, entityClass);
    if (!check.ok) {
      // A wrong manifest no row references yet must not stay under its address.
      if (!unchanged) await deleteObject(r2, manifestKey);
      return json({ error: check.error, message: check.message }, 409);
    }
    refs = check.refs;
    manifestBytes = bytes.byteLength;
    // Everything the manifest names must be stored at the declared size — a
    // truncated PUT would otherwise go live as a broken model.
    const needed = refs.parts.map((p) => ({ path: packagePath('part', p.sha), bytes: p.bytes }));
    if (refs.interiorSha) needed.push({ path: packagePath('interior', refs.interiorSha), bytes: refs.interiorBytes ?? 0 });
    if (kind === 'ship' && refs.rootSha) needed.push({ path: packagePath('hull', refs.rootSha), bytes: -1 });
    const sizes = await mapLimit(needed, 8, async (n) => ({ n, size: await sizeOf(r2, n.path) }));
    const bad = sizes.find((x) => x.size === null || (x.n.bytes >= 0 && x.size !== x.n.bytes));
    if (bad) {
      return json(
        { error: bad.size === null ? 'package_object_missing' : 'package_object_size_mismatch', message: bad.n.path },
        409,
      );
    }
  } catch (e) {
    return json({ error: 'commit_failed', message: (e as Error).message }, 500);
  }

  const { error } = await adminClient.from('asset_packages').upsert(
    {
      kind,
      entity_class: entityClass,
      ship_id: kind === 'ship' ? shipId || entityClass : null,
      manifest_sha256: manifestSha,
      manifest_bytes: manifestBytes,
      root_sha256: refs.rootSha,
      interior_sha256: refs.interiorSha,
      part_count: refs.partCount,
      total_bytes: refs.totalBytes,
      schema_version: refs.schemaVersion,
      uploader_version: uploaderVersion.slice(0, 32),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'kind,entity_class' },
  );
  if (error) return json({ error: 'commit_failed', message: error.message }, 500);
  return json({ ok: true, entity_class: entityClass, part_count: refs.partCount, total_bytes: refs.totalBytes });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('authorization');
  const releaseToken = req.headers.get('x-sc-release-token');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  if (!releaseToken) return json({ error: 'missing_release_token' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: 'server_misconfigured' }, 500);
  }

  // === Auth + role gate (mirrors ingest-bundle) ===
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'unauthorized' }, 401);
  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'collaborator'].includes((profile as { role?: string }).role ?? '')) {
    return json({ error: 'forbidden' }, 403);
  }

  // === Release-token validation ===
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // is_current was dropped by the desktop-channels migration; validity is now a
  // known + non-revoked token (mirrors desktop-latest / ingest-bundle). A query
  // error surfaces as 500 rather than masquerading as an unknown token.
  const { data: release, error: relErr } = await adminClient
    .from('desktop_releases')
    .select('id, token_revoked')
    .eq('release_token', releaseToken)
    // product='uploader' only — the Starscape tray app bakes a release token into
    // a public, unsigned binary, so an unscoped match would accept it here too.
    .eq('product', 'uploader')
    .maybeSingle();
  if (relErr) return json({ error: 'server_misconfigured', message: relErr.message }, 500);
  if (!release) return json({ error: 'unknown_release_token' }, 403);
  if ((release as { token_revoked: boolean }).token_revoked) {
    return json({ error: 'release_token_revoked' }, 403);
  }

  // === Body ===
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (body.action === 'package_sign' || body.action === 'package_commit') {
    return handlePackage(body as PackageBody, adminClient, req.headers.get('x-sc-tool-version') ?? '');
  }

  const shipId = (body.ship_id ?? '').trim();
  if (!SAFE_ID.test(shipId) || isReservedShipId(shipId)) {
    return json({ error: 'unsafe_id', message: `ship_id must match ${SAFE_ID} and not start with _` }, 400);
  }

  const r2 = r2FromEnv((k) => Deno.env.get(k));

  // ---- action: sign ----
  if (body.action === 'sign') {
    const objects = Array.isArray(body.objects) ? body.objects : [];
    if (!objects.length) return json({ error: 'invalid_body', message: 'objects required' }, 400);

    if (r2) {
      const refused = await r2Gate(r2);
      if (refused) return refused;
    }

    const uploads: { path: string; token: string; signedUrl: string; exists?: boolean }[] = [];
    for (const o of objects) {
      const skinId = (o.skin_id ?? '').trim();
      const ext = (o.ext ?? '').trim().toLowerCase();
      if (!SAFE_ID.test(skinId)) {
        return json({ error: 'unsafe_id', message: `skin_id must match ${SAFE_ID}` }, 400);
      }
      if (ext !== 'glb' && ext !== 'webp') {
        return json({ error: 'invalid_body', message: 'ext must be glb|webp' }, 400);
      }
      if (ext === 'glb' && !toolVersionAtLeast(req.headers.get('x-sc-tool-version'), MIN_GLB_TOOL_VERSION)) {
        return json(
          {
            error: 'uploader_outdated',
            message: `3D hulls need uploader ${MIN_GLB_TOOL_VERSION.join('.')} or newer`,
          },
          426,
        );
      }
      const sha = r2 && ext === 'glb' ? hullSha(o.sha256) : null;
      const path = ext === 'glb' ? modelPathFor(shipId, skinId, sha, !!r2) : `${shipId}/${skinId}.${ext}`;
      if (r2) {
        try {
          if (sha) {
            // Content-addressed: the bytes behind this key are final.
            const key = SKINS_PREFIX + path;
            if ((await listObjects(r2, key)).some((x) => x.key === key)) {
              uploads.push({ path, token: '', signedUrl: '', exists: true });
              continue;
            }
          }
          uploads.push({ path, token: '', signedUrl: await presignPut(r2, SKINS_PREFIX + path) });
        } catch (e) {
          return json({ error: 'sign_failed', message: (e as Error).message, path }, 500);
        }
        continue;
      }
      const { data, error } = await adminClient.storage
        .from(BUCKET)
        .createSignedUploadUrl(path, { upsert: true });
      if (error || !data) {
        return json({ error: 'sign_failed', message: error?.message ?? 'no url', path }, 500);
      }
      uploads.push({ path: data.path, token: data.token, signedUrl: data.signedUrl });
    }
    return json({ ok: true, uploads });
  }

  // ---- action: commit ----
  if (body.action === 'commit') {
    const skins = Array.isArray(body.skins) ? body.skins : [];
    if (!skins.length) return json({ error: 'invalid_body', message: 'skins required' }, 400);

    const rows: Record<string, unknown>[] = [];
    for (const s of skins) {
      const skinId = (s.skin_id ?? '').trim();
      if (!SAFE_ID.test(skinId)) {
        return json({ error: 'unsafe_id', message: `skin_id must match ${SAFE_ID}` }, 400);
      }
      const name = (s.name ?? '').trim();
      if (!name) return json({ error: 'invalid_body', message: `name required for ${skinId}` }, 400);
      const source = ALLOWED_SOURCES.has(s.source ?? '') ? s.source : 'store';
      // Paths are derived here — never trusted from the client.
      rows.push({
        ship_id: shipId,
        skin_id: skinId,
        name,
        description: s.description ?? '',
        source,
        name_verified: !!s.name_verified,
        model_path: s.has_model ? modelPathFor(shipId, skinId, r2 ? hullSha(s.model_sha256) : null, !!r2) : null,
        icon_path: s.has_icon ? `${shipId}/${skinId}.webp` : null,
        model_bytes: typeof s.model_bytes === 'number' ? Math.round(s.model_bytes) : null,
        sort: typeof s.sort === 'number' ? s.sort : skinId === 'standard' ? 10 : 100,
      });
    }

    // A shared hull must exist before a row points at it — otherwise a variant
    // could go live with a 404 model (e.g. its PUT failed, or the object was
    // collected between sign and commit). The uploader retries the ship.
    if (r2) {
      for (const p of new Set(rows.map((r) => r.model_path).filter(isHullPath))) {
        const key = SKINS_PREFIX + p;
        let verdict: 'ok' | 'missing' | 'too_large' | 'hash_mismatch' = 'ok';
        try {
          const obj = (await listObjects(r2, key)).find((x) => x.key === key);
          if (!obj) {
            verdict = 'missing';
          } else {
            const { count, error: refErr } = await adminClient
              .from('ship_skins')
              .select('ship_id', { count: 'exact', head: true })
              .eq('model_path', p);
            if (refErr) throw new Error(refErr.message);
            if (needsVerification(p, count)) {
              verdict = await checkHull(p, obj.size, () => getObject(r2, key, MAX_HULL_BYTES));
              // Unreferenced, so no other ship can be using these wrong bytes.
              if (verdict !== 'ok') await deleteObject(r2, key);
            }
          }
        } catch (e) {
          return json({ error: 'commit_failed', message: (e as Error).message }, 500);
        }
        if (verdict !== 'ok') return json({ error: `hull_${verdict}`, message: p }, 409);
      }
    }
    // The shared hulls this ship used before the commit — GC candidates below.
    const { data: before, error: beforeErr } = await adminClient
      .from('ship_skins')
      .select('model_path')
      .eq('ship_id', shipId);
    if (beforeErr) return json({ error: 'commit_failed', message: beforeErr.message }, 500);

    const { error } = await adminClient
      .from('ship_skins')
      .upsert(rows, { onConflict: 'ship_id,skin_id' });
    if (error) return json({ error: 'commit_failed', message: error.message }, 500);

    // Replace semantics: drop what this commit no longer lists. Ids are
    // SAFE_ID-checked, so they can go into the filter list unquoted.
    const keepIds = rows.map((r) => r.skin_id as string);
    const { error: rowErr } = await adminClient
      .from('ship_skins')
      .delete()
      .eq('ship_id', shipId)
      .not('skin_id', 'in', `(${keepIds.join(',')})`);
    if (rowErr) return json({ error: 'prune_failed', message: rowErr.message }, 500);
    const keepPaths = new Set(
      rows.flatMap((r) => [r.model_path, r.icon_path]).filter((p): p is string => !!p),
    );
    let prunedR2 = 0;
    if (r2) {
      try {
        const listedR2 = await listObjects(r2, `${SKINS_PREFIX}${shipId}/`);
        for (const o of listedR2) {
          if (keepPaths.has(o.key.slice(SKINS_PREFIX.length))) continue;
          await deleteObject(r2, o.key);
          prunedR2++;
        }
        // Shared hulls: delete one only when NO row (of any ship) references
        // it any more. Accepted race: a concurrent commit that passed its
        // existence check just before this delete ends up with a 404 model. This ship's rows are already upserted/pruned above.
        const prev = ((before ?? []) as { model_path: string | null }[]).map((r) => r.model_path);
        for (const p of droppedHulls(prev, keepPaths)) {
          const { count, error: refErr } = await adminClient
            .from('ship_skins')
            .select('ship_id', { count: 'exact', head: true })
            .eq('model_path', p);
          if (refErr) throw new Error(refErr.message);
          if (count !== 0) continue; // still shared (or unknown) — keep it
          await deleteObject(r2, SKINS_PREFIX + p);
          prunedR2++;
        }
      } catch (e) {
        return json({ error: 'prune_failed', message: (e as Error).message }, 500);
      }
      // Everything this ship still needs is in R2 now; the Supabase copy goes.
      keepPaths.clear();
    }
    const { data: listed, error: listErr } = await adminClient.storage
      .from(BUCKET)
      .list(shipId, { limit: 1000 });
    if (listErr) return json({ error: 'prune_failed', message: listErr.message }, 500);
    const stale = (listed ?? [])
      .map((o) => `${shipId}/${o.name}`)
      .filter((p) => !keepPaths.has(p));
    if (stale.length) {
      const { error: rmErr } = await adminClient.storage.from(BUCKET).remove(stale);
      if (rmErr) return json({ error: 'prune_failed', message: rmErr.message }, 500);
    }
    return json({ ok: true, count: rows.length, pruned: stale.length + prunedR2 });
  }

  return json({ error: 'invalid_body', message: "action must be 'sign' or 'commit'" }, 400);
});
