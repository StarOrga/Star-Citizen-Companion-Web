// Size cap for telemetry_events.detail (AUD-344, plan D02 step 7).
//
// `detail` is free-form JSON from the client (usage detail, or a crash's
// `extra`). The largest legitimate payloads today (job diagnostics, extract
// aborts) are a few hundred bytes; transcripts go to error_stack, which is
// clamped separately. Anything above MAX_DETAIL_BYTES is replaced by a marker
// instead of being cut — a truncated JSON string would not be valid JSON.
//
// Pure module (no Deno globals) so `node --test` can run _detail.test.ts.

export const MAX_DETAIL_BYTES = 4096;

export function capDetail(value: unknown, max: number = MAX_DETAIL_BYTES): unknown {
  if (value === null || value === undefined) return null;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    return { _dropped: 'unserializable' };
  }
  // JSON.stringify returns undefined for a bare function / symbol.
  if (json === undefined) return { _dropped: 'unserializable' };
  const bytes = new TextEncoder().encode(json).length;
  if (bytes <= max) return value;
  return { _truncated: true, bytes };
}
