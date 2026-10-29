// CIG fills AttachDef.Type / SubType with the literal "UNDEFINED" when an item
// has no value. The extractor already turns that into null; this is the
// defensive second line for rows from an older uploader. Pure — unit tested in
// _placeholders.test.mjs.

const PLACEHOLDER = /^\s*undefined\s*$/i;

/** Top-level columns that carry an AttachDef type / sub-type. */
const COLUMNS = ['sub_type', 'attach_type'] as const;
/** The same values inside the row's `payload` jsonb (extractor field names). */
const PAYLOAD_KEYS = ['subType', 'attachType'] as const;

function scrub(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  let out = obj;
  for (const k of keys) {
    const v = out[k];
    if (typeof v === 'string' && PLACEHOLDER.test(v)) {
      if (out === obj) out = { ...obj };
      out[k] = null;
    }
  }
  return out;
}

/** One catalog row with the "UNDEFINED" placeholder in type / sub-type -> null. */
export function nullUndefinedPlaceholders(row: unknown): unknown {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  let out = scrub(row as Record<string, unknown>, COLUMNS);
  const payload = out.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const clean = scrub(payload as Record<string, unknown>, PAYLOAD_KEYS);
    if (clean !== payload) out = { ...out, payload: clean };
  }
  return out;
}
