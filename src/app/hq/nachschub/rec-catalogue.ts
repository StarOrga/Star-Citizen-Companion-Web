/*
 * Adapter: codex FPS catalogue rows -> the flattened catalogue "Passt dazu" (recommend.ts) scores.
 *
 * What the codex tables carry and what they do not (docs/concepts/nachschub-recommendations-research.md section 6):
 *  - armor set key: NOT a column. Derived from the class name - every token before the part token (`helmet`, `core`,
 *    `arms`, `legs`, `backpack`, `undersuit`) is the set, e.g. `pembroke_armor_heavy_helmet_01_01_01` -> `pembroke_armor_heavy`.
 *  - armor part: the attach type (`Char_Armor_Helmet` ...), a column.
 *  - weapon magazine: NOT a column; `magazineClass` stays empty, so a weapon is only matched by maker and activity.
 *  - ships, ship components, paints, blueprints/recipes, places: not adapted here (they need payload reads per row);
 *    the engine simply finds no relation for them. The FPS side (armor sets, FPS weapons of one maker) is what the cart
 *    suggests today.
 */
import type { CodexListRow } from '../../codex/codex.service';
import type { RecItem } from './recommend';

const PART_TOKENS = ['helmet', 'core', 'torso', 'arms', 'legs', 'backpack', 'undersuit'] as const;

/** attach type -> armor part of the recommendation engine's fixed order. */
export function armorPartOf(attachType: string | null): string | null {
  const t = (attachType ?? '').toLowerCase();
  if (t.endsWith('helmet')) return 'helmet';
  if (t.endsWith('torso')) return 'torso';
  if (t.endsWith('arms')) return 'arms';
  if (t.endsWith('legs')) return 'legs';
  if (t.endsWith('backpack')) return 'backpack';
  if (t.endsWith('undersuit')) return 'undersuit';
  return null;
}

/** The set an armor class belongs to: the class name up to its part token; null when there is no such token. */
export function armorSetKey(className: string): string | null {
  const tokens = className.toLowerCase().split('_');
  const at = tokens.findIndex((t, i) => i > 0 && (PART_TOKENS as readonly string[]).includes(t));
  return at > 0 ? tokens.slice(0, at).join('_') : null;
}

/** Catalogue entries of one FPS catalogue read; variants are kept (the engine excludes them) so a wished variant resolves. */
export function fpsRowsToRecItems(rows: readonly CodexListRow[], category: 'armor' | 'weapon'): RecItem[] {
  const out: RecItem[] = [];
  for (const r of rows) {
    const className = r.classNameSlug;
    if (!className) continue;
    const name = r.nameLocalized?.trim() || className;
    if (category === 'armor') {
      out.push({
        className,
        name,
        kind: 'armor',
        manufacturer: r.manufacturerCode,
        setKey: armorSetKey(className),
        armorPart: armorPartOf(r.attachType),
        grade: gradeNumber(r.grade),
        activity: 'fps',
        isVariant: r.isVariant,
      });
    } else {
      out.push({
        className,
        name,
        kind: 'fps_weapon',
        manufacturer: r.manufacturerCode,
        slotType: 'fps_weapon',
        size: r.size,
        grade: gradeNumber(r.grade),
        activity: 'fps',
        isVariant: r.isVariant,
      });
    }
  }
  return out;
}

function gradeNumber(g: string | null): number | null {
  if (g == null) return null;
  const n = Number(g);
  return Number.isFinite(n) ? n : null;
}
