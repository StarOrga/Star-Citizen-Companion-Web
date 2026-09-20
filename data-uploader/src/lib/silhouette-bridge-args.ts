/**
 * Pure argv-building for the silhouette build sidecar
 * (`sc_extract.silhouette_build_app`) — kept free of `electron` /
 * `node:child_process` so it is unit-testable without a running Electron
 * process (`main/silhouette-bridge.ts` is not: it spawns the real child and
 * wires real IPC, exactly like `main/skin-bridge.ts`, which has no test of
 * its own for the same reason — see `test/silhouette-bridge-args.spec.ts`).
 */

export interface SilhouetteBuildNat {
  channel: string;
  patchVersion: string;
  buildNumber: string;
}

export interface SilhouetteBuildRequest {
  p4kPath: string;
  /** Extractor out_dir — reads `silhouettes/_build_manifest.json` from here
   *  by default, writes `silhouettes/rows/<kind>__<class>.json` here. */
  outDir: string;
  /** Absolute path to the (already-downloaded) cgf-converter binary. */
  converterPath: string;
  toolVersion: string;
  build: SilhouetteBuildNat;
  /** Overrides `<outDir>/silhouettes/_build_manifest.json`. */
  manifestPath?: string;
  toleranceM?: number;
}

/**
 * The exact argv `silhouette_build_app.py` expects — same flag names/shapes
 * the CLI driver (`silhouette_build.py`) and the events app share, so a
 * command copy-pasted from `main.log` for manual debugging works unmodified.
 */
export function silhouetteBuildArgs(req: SilhouetteBuildRequest): string[] {
  const buildJson = JSON.stringify({
    channel: req.build.channel,
    patchVersion: req.build.patchVersion,
    buildNumber: req.build.buildNumber,
  });
  const args = [
    '-E', '-s', '-B', '-u',
    '-X', 'utf8', // force UTF-8 stdio — see skin-bridge.ts's identical flag for the full rationale
    '-m', 'sc_extract.silhouette_build_app',
    '--p4k', req.p4kPath,
    '--out', req.outDir,
    '--converter', req.converterPath,
    '--tool-version', req.toolVersion,
    '--build-json', buildJson,
  ];
  if (req.manifestPath) args.push('--manifest', req.manifestPath);
  if (req.toleranceM != null) args.push('--tolerance-m', String(req.toleranceM));
  return args;
}
