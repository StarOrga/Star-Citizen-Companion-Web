import type { StepKind } from '../../shared/step/sc-step.component';

/**
 * The seven action icons of an Einsatz (concept 20261107-1410-nachschub-hq, round 4): what you DO at a place.
 * Stroke paths in a 24x24 box (stroke 1.8, round caps), shared by the route graphic, its legend and the Einsatz
 * cards, so one verb always looks the same. The tray with a down arrow is the Nachschub icon of HQ.
 */
export const STEP_ICON_PATHS: Readonly<Record<StepKind, readonly string[]>> = {
  buy: ['M5.5 8h13l-1 12h-11z', 'M9 8V6.5a3 3 0 0 1 6 0V8'],
  mission: ['M6 21V4', 'M6 4h11l-2.5 4L17 12H6'],
  mine: ['M4 20l9.5-9.5', 'M10 4.5c4.5-1 8.5 1.5 9.5 6-2.2-1.6-4.6-2.3-7-2.1', 'M12.5 8.5l3 3'],
  refine: ['M9.5 3.5h5', 'M10.5 3.5v5.5L5.6 17.6A2 2 0 0 0 7.4 20.5h9.2a2 2 0 0 0 1.8-2.9L13.5 9V3.5', 'M7.5 14.5h9'],
  craft: ['M14.5 4.5l5 5-2.5 2.5-5-5z', 'M12 9.5L4.5 17a1.8 1.8 0 0 0 2.5 2.5L14.5 12'],
  transport: ['M3 7h11v9H3z', 'M14 10h4l3 3v3h-7'],
  pickup: ['M4 11h16v9H4z', 'M12 3v9', 'M8.5 6.5L12 3l3.5 3.5'],
  /* Event: a four-pointed spark (the star burst of a limited-time event). */
  event: ['M12 3l2 6.2 6.2 2.8-6.2 2.8L12 21l-2-6.2L3.8 12 10 9.2z'],
};

/** The two wheels of the transport truck (circles do not fit the path list). */
export const TRANSPORT_WHEELS: readonly { cx: number; cy: number; r: number }[] = [
  { cx: 7, cy: 18, r: 1.6 },
  { cx: 17, cy: 18, r: 1.6 },
];

/** Tray with a down arrow: the Nachschub icon in HQ. */
export const NACHSCHUB_ICON_PATHS: readonly string[] = ['M12 3v8', 'M8.5 7.5L12 11l3.5-3.5', 'M4 13h5l1.5 2.5h3L15 13h5v7H4z'];
