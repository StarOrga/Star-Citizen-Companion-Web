import { describe, it, expect } from 'vitest';
import { silhouetteBuildArgs, type SilhouetteBuildRequest } from '../src/lib/silhouette-bridge-args.js';

const BASE: SilhouetteBuildRequest = {
  p4kPath: 'C:/SC/LIVE/Data.p4k',
  outDir: 'C:/out/extract-123',
  converterPath: 'C:/tools/cgf-converter-2.exe',
  toolVersion: '0.31.0',
  build: { channel: 'LIVE', patchVersion: '4.9.0', buildNumber: '123456' },
};

describe('silhouetteBuildArgs', () => {
  it('spawns the events-emitting sidecar module with UTF-8-forced flags', () => {
    const args = silhouetteBuildArgs(BASE);
    expect(args.slice(0, 8)).toEqual(['-E', '-s', '-B', '-u', '-X', 'utf8', '-m', 'sc_extract.silhouette_build_app']);
  });

  it('passes p4k/out/converter/tool-version verbatim', () => {
    const args = silhouetteBuildArgs(BASE);
    expect(args).toContain('--p4k');
    expect(args[args.indexOf('--p4k') + 1]).toBe(BASE.p4kPath);
    expect(args[args.indexOf('--out') + 1]).toBe(BASE.outDir);
    expect(args[args.indexOf('--converter') + 1]).toBe(BASE.converterPath);
    expect(args[args.indexOf('--tool-version') + 1]).toBe(BASE.toolVersion);
  });

  it('serialises build identity as a single --build-json blob', () => {
    const args = silhouetteBuildArgs(BASE);
    const raw = args[args.indexOf('--build-json') + 1];
    expect(JSON.parse(raw)).toEqual({
      channel: 'LIVE', patchVersion: '4.9.0', buildNumber: '123456',
    });
  });

  it('omits --manifest and --tolerance-m when not given', () => {
    const args = silhouetteBuildArgs(BASE);
    expect(args).not.toContain('--manifest');
    expect(args).not.toContain('--tolerance-m');
  });

  it('adds --manifest when a manifest path override is given', () => {
    const args = silhouetteBuildArgs({ ...BASE, manifestPath: 'C:/out/extract-123/silhouettes/_build_manifest.json' });
    expect(args[args.indexOf('--manifest') + 1]).toBe('C:/out/extract-123/silhouettes/_build_manifest.json');
  });

  it('adds --tolerance-m, including an explicit 0', () => {
    expect(silhouetteBuildArgs({ ...BASE, toleranceM: 0.2 })).toContain('--tolerance-m');
    const args = silhouetteBuildArgs({ ...BASE, toleranceM: 0 });
    expect(args[args.indexOf('--tolerance-m') + 1]).toBe('0');
  });
});
