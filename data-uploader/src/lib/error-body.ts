/**
 * Make a server error body safe to put on one log line.
 *
 * A Cloudflare 520 in front of Supabase arrives as a whole HTML page, and the
 * ingest function forwards it as the `message` of a 500. Logged raw it spread
 * ~25 lines per failure through main.log. Collapse HTML to its <title> and cap
 * everything else to one bounded line.
 */
const MAX_LEN = 300;

export function collapseErrorBody(body: string): string {
  const text = String(body ?? '');
  if (/<\s*(!doctype|html|head|body)\b/i.test(text)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1];
    const clean = (title ?? 'no title').replace(/\s+/g, ' ').trim();
    return `[HTML error page: ${clean.slice(0, 160)}]`;
  }
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_LEN ? `${oneLine.slice(0, MAX_LEN)}…` : oneLine;
}
