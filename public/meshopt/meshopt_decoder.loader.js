/* Classic-script shim for model-viewer's meshopt decoder gate (#305).
 *
 * model-viewer registers its (already bundled) MeshoptDecoder only once
 * `meshoptDecoderLocation` resolves, and it loads that URL as a CLASSIC script:
 *
 *   const fetchScript = (src) => new Promise((resolve, reject) => {
 *     const script = document.createElement('script');   // <- no type="module"
 *     ...
 *     script.src = src;
 *   });
 *
 * Pointing it straight at three's `meshopt_decoder.module.js` therefore injects
 * an ES module into a classic script tag. The decoder still works (model-viewer
 * uses its own bundled copy), but the injected file throws
 * `SyntaxError: Unexpected token 'export'` into the page — harmless in the app,
 * fatal in Karma, where an uncaught SyntaxError kills the browser and takes the
 * whole suite with it (seen at 17 of 779 specs).
 *
 * So this file is what the location points at: valid classic script, and it does
 * real work rather than merely satisfying the gate — it dynamic-imports the same
 * module three ships and publishes the decoder globally. If model-viewer ever
 * starts depending on the fetched script's side effect instead of its bundled
 * copy, this keeps working.
 *
 * Deliberately derived from three's module (the version model-viewer itself
 * imports) rather than from a separate `meshoptimizer` package, so the two can
 * never version-drift.
 */
import('./meshopt_decoder.module.js')
  .then((mod) => {
    self.MeshoptDecoder = mod.MeshoptDecoder;
  })
  .catch(() => {
    /* model-viewer falls back to its bundled decoder; a meshopt hull that cannot
       be decoded at all surfaces as the viewer's normal load error. */
  });
