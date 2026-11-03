// Missions (contracts) for the global search — ingest-catalog op `missions`
// (migration 20261103130000_codex_missions). The uploader sends the extractor's
// missions/<class>.json bodies (sc_extract/missions.py); this maps them to
// codex_missions rows with a pinned column set, so a grown extractor field can
// never reach the table. Pure — unit tested in _missions.test.mjs.

/** One request stays far inside a statement budget. */
export const MAX_MISSION_ROWS = 1000;

type Loc = { en?: unknown; de?: unknown } | null | undefined;

const text = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && !s.startsWith('@') ? s.slice(0, max) : null;
};
const en = (l: Loc, max = 300): string | null => (l && typeof l === 'object' ? text(l.en, max) ?? text(l.de, max) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const CLASS_RE = /^[A-Za-z0-9_.-]{1,200}$/;

export interface MissionBuild {
  build_id: string;
  channel: string;
  patch_version: string;
  build_number: string;
}

/**
 * Map extractor mission bodies to codex_missions rows. Bodies without a usable
 * class name or without any readable title (clean title or type name) are
 * dropped — the title is never invented. Duplicate class names: last wins.
 */
export function parseMissions(list: unknown, build: MissionBuild): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  const out = new Map<string, Record<string, unknown>>();
  for (const raw of list) {
    const m = obj(raw);
    const cn = typeof m.className === 'string' ? m.className.trim() : '';
    if (!CLASS_RE.test(cn)) continue;
    const type = obj(m.type);
    const typeName = en(type.name as Loc, 120);
    const title = en(m.titleClean as Loc) ?? typeName;
    if (!title) continue;
    const loc = obj(m.location);
    const reward = obj(m.reward);
    const amount = typeof reward.amount === 'number' && Number.isFinite(reward.amount) && reward.amount > 0
      ? Math.min(Math.round(reward.amount), 2_000_000_000) : null;
    const { source: _source, ...payload } = m;
    out.set(cn, {
      ...build,
      class_name: cn,
      guid: text(m.guid, 64),
      title,
      title_raw: en(m.title as Loc),
      type_class: text(type.className, 120),
      type_name: typeName,
      giver_name: en(obj(m.giver).name as Loc, 160),
      location_class: text(loc.className, 160),
      location_name: en(loc.name as Loc, 160),
      reward_amount: amount,
      reward_currency: amount ? text(reward.currency, 16) : null,
      lawful: typeof m.lawful === 'boolean' ? m.lawful : null,
      category: text(m.category, 160),
      payload,
    });
  }
  return [...out.values()];
}
