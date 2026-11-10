/**
 * The first snap step of the page that snaps right now (stage → lower part, px), written by
 * `wireSnap` (`verse/pages/briefing/briefing-dock.ts`) and read by the shell's header morph
 * (`fusion-bar`), which spans exactly this travel. Its own tiny module, so the shell does not
 * pull a page's code into the first bundle. Null while no page snaps.
 */
let travel: number | null = null;

export function snapTravelPx(): number | null {
  return travel;
}

export function setSnapTravelPx(px: number | null): void {
  travel = px !== null && px > 0 ? px : null;
}
