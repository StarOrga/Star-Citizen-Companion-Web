import {
  EntityPayloadEntry,
  READINESS_KEYS,
  ReadinessKey,
  ReadinessSlot,
  computeReadiness,
} from '../codex-landing-kpi';
import { RoleLoadoutRole } from '../../hangar/hangar.types';

/**
 * The set page's readiness row — the glyphs top-right in the stage. Moved out
 * of the retired six-slot board panel (AUD-065) so the logic is a pure helper
 * rather than a component's computed.
 *
 * One glyph per readiness class. Inline paths rather than an icon font: the row
 * must render identically offline and the set is closed at six — the six
 * classes the archive actually carries (see computeReadiness). Mining, salvage
 * and tractor are no classes of their own on purpose: the handheld tools are
 * Gadgets, a "mining ready" mark would claim more.
 */
export const READY_ICON_PATHS: Readonly<Record<ReadinessKey, string>> = {
  primary: 'M3 9h14l4 3-4 1v3h-5l-2-3H6zM8 16v4',
  secondary: 'M4 8h11l3 3h3M7 11v5h4l2-5',
  melee: 'M4 20l7-7M13 11l7-7-2 8-5 5z',
  throwable: 'M12 20a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 8V5h3',
  gadget: 'M7 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM7 10V6h10v4',
  medical: 'M12 6v12M6 12h12',
};

/** One readiness glyph as the stage renders it. */
export interface ReadinessGlyph extends ReadinessSlot {
  /** SVG path in a 24x24 box. */
  icon: string;
  /** i18n key of the class name ("Primärwaffe"). */
  labelKey: string;
  /** i18n key of the state ("angelegt" / "fehlt"). */
  stateKey: string;
}

/**
 * The readiness classes the set's role can hold, of the six the archive
 * carries, each with its glyph and the two keys the tooltip is built from.
 * Only classes with a known glyph survive — a class without one would render
 * as an empty square.
 */
export function setReadiness(
  items: readonly { className: string | null }[],
  payloads: ReadonlyMap<string, EntityPayloadEntry>,
  role?: RoleLoadoutRole | null,
): ReadinessGlyph[] {
  return computeReadiness(items, payloads, role ?? undefined)
    .filter((r) => (READINESS_KEYS as readonly string[]).includes(r.key) && !!READY_ICON_PATHS[r.key])
    .map((r) => ({
      ...r,
      icon: READY_ICON_PATHS[r.key],
      labelKey: 'codex.landing.board.readiness.' + r.key,
      stateKey: r.ok ? 'codex.landing.board.readyOn' : 'codex.landing.board.readyOff',
    }));
}
