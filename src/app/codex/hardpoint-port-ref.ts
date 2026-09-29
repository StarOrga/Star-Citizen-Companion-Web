/**
 * A port the detail view wants located on the 3D model.
 *
 * Lives in its own file (not in ship-skin-viewer.component.ts) so the pages
 * that only pass these refs through can import the TYPE without referencing
 * the viewer module outside their `@defer` blocks — any such reference would
 * make Angular load the ~470 kB model-viewer/three chunk eagerly again (AUD-048).
 */
export interface HardpointPortRef {
  /** Raw port name — the key every hardpoint view highlights by. */
  port: string;
  label: string;
  itemName: string | null;
}
