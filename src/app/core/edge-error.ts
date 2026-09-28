/**
 * Shared reader for the JSON error bodies our Edge Functions send.
 *
 * `supabase.functions.invoke` leaves `data` null on a non-2xx answer and puts
 * the raw `Response` on `error.context` (FunctionsHttpError). The body — our
 * `{ error: '<code>', message?: '…' }` — has to be read from there. One file
 * for every caller (ship links, account deletion, and the error translator of
 * audit plan D05), so there is exactly one body reader in the app.
 */
export interface EdgeErrorBody {
  ok?: boolean;
  error?: string;
  message?: string;
}

/**
 * Pull our JSON error body off a FunctionsHttpError. `error.context` is the raw
 * `Response`; anything else (network error, relay error) yields an empty payload
 * so the caller falls back to the generic message.
 */
export async function readErrorBody(error: unknown): Promise<EdgeErrorBody> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (!(ctx instanceof Response)) return {};
  try {
    const parsed: unknown = await ctx.clone().json();
    return parsed && typeof parsed === 'object' ? (parsed as EdgeErrorBody) : {};
  } catch {
    return {};
  }
}
