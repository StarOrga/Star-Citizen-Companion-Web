// process-p4k — analyzes a P4K upload metadata row, downloads the file head from
// Storage, runs lightweight heuristics (channel/version sanity, header magic,
// estimated entry count from CryEngine PAK signature), then writes the result
// back via service_role. JWT verification is on — only the uploader's session
// can trigger processing for their own row.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RequestBody { upload_id: string }

interface ParseResult {
  magicOk: boolean;
  magic: string | null;
  headerVersion: number | null;
  estimatedEntries: number | null;
  fileSizeBytes: number;
  channelHint: string;
  versionHint: string | null;
  notes: string[];
  parsedAt: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authHeader = req.headers.get('Authorization');
  if (!supabaseUrl || !serviceKey) return json({ error: 'env missing' }, 500);
  if (!authHeader) return json({ error: 'auth missing' }, 401);

  // Identify caller via anon client + bearer token.
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401);

  // Service client for full access.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const body: RequestBody = await req.json();
  if (!body.upload_id) return json({ error: 'upload_id required' }, 400);

  const { data: row, error: rowErr } = await admin
    .from('p4k_uploads')
    .select('*')
    .eq('id', body.upload_id)
    .single();
  if (rowErr || !row) return json({ error: 'upload not found' }, 404);
  if (row.user_id !== userData.user.id) return json({ error: 'forbidden' }, 403);

  // Mark processing.
  await admin.from('p4k_uploads').update({ status: 'processing' }).eq('id', row.id);

  try {
    const { data: head, error: dlErr } = await admin.storage
      .from('p4k-uploads')
      .download(row.storage_path);
    if (dlErr || !head) throw dlErr ?? new Error('download failed');

    const buf = new Uint8Array(await head.slice(0, 64 * 1024).arrayBuffer());
    const result = parseHeader(buf, row);

    await admin.from('p4k_uploads').update({
      status: 'done',
      result,
      processed_at: new Date().toISOString(),
    }).eq('id', row.id);

    return json({ ok: true, result });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    await admin.from('p4k_uploads').update({
      status: 'failed',
      error: msg,
      processed_at: new Date().toISOString(),
    }).eq('id', row.id);
    return json({ ok: false, error: msg }, 500);
  }
});

function parseHeader(buf: Uint8Array, row: Record<string, unknown>): ParseResult {
  const notes: string[] = [];
  const magic = buf.length >= 4 ? new TextDecoder().decode(buf.subarray(0, 4)) : null;
  const magicOk = magic === 'PK' || magic === 'CrCh' || magic === 'CrPk';
  if (!magicOk) notes.push('Unknown magic — file may not be a CryEngine PAK / ZIP.');

  // ZIP central-directory hint (last 64KB usually contains EOCD record).
  let estimatedEntries: number | null = null;
  let headerVersion: number | null = null;
  if (magicOk) {
    const view = new DataView(buf.buffer);
    if (magic === 'PK') {
      headerVersion = view.getUint16(4, true);
      notes.push(`ZIP local-file-header version = ${headerVersion}`);
      // Naive count: matches of local-file-header signature in the 64KB head.
      let count = 0;
      for (let i = 0; i < buf.length - 3; i++) {
        if (buf[i] === 0x50 && buf[i+1] === 0x4b && buf[i+2] === 0x03 && buf[i+3] === 0x04) count++;
      }
      estimatedEntries = count;
    }
  }

  return {
    magicOk,
    magic,
    headerVersion,
    estimatedEntries,
    fileSizeBytes: Number(row['size_bytes'] ?? 0),
    channelHint: String(row['detected_channel'] ?? 'unknown'),
    versionHint: row['detected_version'] != null ? String(row['detected_version']) : null,
    notes,
    parsedAt: new Date().toISOString(),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
