/**
 * Minimal SemVer 2.0.0 precedence — extracted from updater.ts so the update
 * gating logic is unit-testable WITHOUT importing electron/electron-updater
 * (which can't load under vitest's node runtime).
 *
 * Only the subset the updater needs: strict "is A newer than B" over
 * `x.y.z[-prerelease]` strings, with build metadata (`+…`) ignored.
 */

/**
 * SemVer 2.0.0 precedence (§11) — true when `latest` is strictly newer than
 * `current`. A plain x.y.z compare ignored pre-release tags, so on the alpha/beta
 * rings 1.2.0-alpha.2 looked equal to 1.2.0-alpha.1 (and to the final 1.2.0,
 * which must outrank any of its pre-releases). Build metadata (`+…`) is ignored.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareSemver(latest, current) > 0;
}

/** -1 | 0 | 1 SemVer comparison of two `x.y.z[-prerelease]` strings. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): { main: number[]; pre: string[] } => {
    const raw = v.trim().replace(/^v/, '').split('+', 1)[0]; // drop build metadata
    const dash = raw.indexOf('-');
    const core = dash === -1 ? raw : raw.slice(0, dash);
    const preStr = dash === -1 ? '' : raw.slice(dash + 1);
    const main = core.split('.').map((n) => parseInt(n, 10) || 0);
    while (main.length < 3) main.push(0);
    return { main, pre: preStr ? preStr.split('.') : [] };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa.main[i] !== pb.main[i]) return pa.main[i] > pb.main[i] ? 1 : -1;
  }
  // Equal core: a build WITHOUT a pre-release outranks one that has one.
  if (pa.pre.length === 0 || pb.pre.length === 0) {
    if (pa.pre.length === pb.pre.length) return 0;
    return pa.pre.length === 0 ? 1 : -1;
  }
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1; // fewer identifiers → lower precedence
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return parseInt(x, 10) > parseInt(y, 10) ? 1 : -1;
    if (xn) return -1; // numeric identifiers rank below alphanumeric ones
    if (yn) return 1;
    return x > y ? 1 : -1; // ASCII lexical order
  }
  return 0;
}
