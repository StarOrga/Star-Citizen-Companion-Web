/**
 * Ship gate: prove a merged change is actually REACHABLE, then print the review
 * reply that says so — with the time it was observed, not a time it was hoped.
 *
 * Why this exists. `docs/feedback-routine.md` § "Post-ship review & continue"
 * has said since PR #534 that the routine must poll the Production deployment
 * for the merge SHA before telling the admin to look, and must never write a
 * guessed duration ("~1 Min", "gleich", "in Kürze"). The rule is prose in a
 * 2000-line runbook, and prose lost:
 *
 *   - Topic `ae9f8cba` (PR #534): merged 22:46:06Z, reply 36 s later promising
 *     "Vercel braucht nach dem Merge ~1 Min". 30 minutes on there was still no
 *     Production deployment for that SHA at all.
 *   - Topic `a33ba528` (PR #531), the SAME night, hours after that lesson was
 *     written down: merged 22:02:38Z, reply 68 s later with the identical
 *     "~1 Min". The admin looked at 22:06:56Z and answered "ich sehe live 0
 *     unterschied?!". He was right — the deployment for the merge SHA did not
 *     report success until 22:12:10Z, five minutes after he looked.
 *
 * Twice is not forgetfulness, it is a process defect: at the end of a ship the
 * correct reply costs a poll loop and the wrong one costs nothing, so the wrong
 * one wins. This script inverts that. It does the waiting, and it is the only
 * thing that emits the ✅ wording — when the deployment has not been observed
 * green it prints the ⏳ "merged, not live yet" reply instead and exits non-zero,
 * so a ✅ that nobody verified cannot be produced by accident.
 *
 * The second half of "ich sehe nix" is the PWA: ngsw serves the cached shell to
 * every returning visitor, and the admin is always a returning visitor. So the
 * hard-reload caveat is baked into the ✅ text rather than left to memory, and
 * the content probe fetches with `?ngsw-bypass=true` for the same reason.
 *
 * Usage:
 *   node scripts/verify-ship-live.mjs \
 *     --pr https://github.com/StarOrga/Star-Citizen-Companion-Web/pull/531 \
 *     --changed "Die Statistikseite zeigt jetzt Wochen-Deltas statt Gesamtsummen." \
 *     --route admin/feedback \
 *     --probe verdictDown
 *
 *   --sha <sha>        commit to verify        (default: git rev-parse origin/main);
 *                      a short SHA is resolved to the full one — the deployments
 *                      endpoint silently returns nothing for an abbreviated id
 *   --pr <url>         PR link for the reply
 *   --changed <text>   one sentence on what changed
 *   --route <path>     the exact route to send the admin to (default: /).
 *                      Pass it WITHOUT the leading slash — Git Bash rewrites a
 *                      leading-slash argument into a Windows path
 *                      (`/admin/feedback` → `C:/Program Files/Git/admin/feedback`)
 *                      and would silently bake that into the reply.
 *   --probe <needle>   string the merge introduced, grepped in --probe-url.
 *                      Default: the version the commit carries in package.json,
 *                      looked for as `"current": "<version>"` in release-notes.json
 *                      — every ship bumps it, so every ship can be probed
 *   --probe-url <url>  unhashed asset to grep: a full URL, or a path on the site
 *                      WITHOUT the leading slash (Git Bash mangles it, see --route).
 *                      Default: release-notes.json for the version probe,
 *                      i18n/de.json for an explicit --probe
 *   --timeout <sec>    give up after this long  (default: 900 = 15 min)
 *   --interval <sec>   poll every               (default: 30)
 *   --once             single check, no polling — for a quick status read
 *
 * Exit code: 0 only when the deployment for the SHA was observed `success`.
 */
import { execFileSync } from 'node:child_process';

const REPO = 'StarOrga/Star-Citizen-Companion-Web';
const SITE = 'https://sc-companion.vercel.app';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const log = (...m) => console.error(...m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hhmm = (d = new Date()) =>
  new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(d);

const gh = (path) =>
  JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 8 << 20 }));

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/**
 * The deployments endpoint wants the FULL sha: `?sha=1bfc9f2` is not an error,
 * it is an empty list, which this script reads as "no deployment yet" and polls
 * on a deploy that was green all along (the 15:07 run on 2026-09-13 restarted
 * twice over it). Resolve whatever was passed — locally first, then via the
 * commits endpoint for a merge this clone has not fetched yet.
 */
const isFullSha = (value) => /^[0-9a-f]{40}$/i.test(value ?? '');
const resolveSha = (value) => {
  if (!value) return git('rev-parse', 'origin/main');
  if (isFullSha(value)) return value.toLowerCase();
  try {
    return git('rev-parse', '--verify', '--quiet', `${value}^{commit}`);
  } catch {
    /* not in this clone — ask GitHub */
  }
  let full = null;
  try {
    full = gh(`repos/${REPO}/commits/${value}`).sha;
  } catch {
    /* fall through to the loud exit below */
  }
  if (!isFullSha(full)) {
    log(`--sha "${value}" is neither a local commit nor known to GitHub — pass the merge SHA.`);
    process.exit(2);
  }
  return full;
};
const sha = resolveSha(flag('sha'));
const pr = flag('pr', '<PR-Link>');
const changed = flag('changed', '<ein Satz>');
/**
 * Git Bash rewrites any argument that starts with `/` into a Windows path, so
 * `--route /admin/feedback` arrives as `C:/Program Files/Git/admin/feedback` and
 * the reply would send the admin to a nonsense URL. Refuse that loudly rather
 * than guessing which half was meant.
 */
const normaliseRoute = (value) => {
  if (!value) return '/';
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    log(
      `route "${value}" looks like a Git-Bash-mangled path.\n` +
        'Pass the route WITHOUT the leading slash (--route admin/feedback), or set MSYS_NO_PATHCONV=1.',
    );
    process.exit(2);
  }
  return value === '/' ? '/' : `/${value.replace(/^\/+/, '')}`;
};
const route = normaliseRoute(flag('route'));
/**
 * The version the commit carries — the one needle every ship introduces, so a
 * run never has to invent one (and never grep `i18n/de.json` for a change that
 * touched no string, which is how the 14:07 run on 2026-09-13 polled a live
 * deploy to a miss).
 */
const versionAt = (commit) => {
  try {
    return JSON.parse(git('show', `${commit}:package.json`)).version ?? null;
  } catch {
    /* not in this clone */
  }
  try {
    const { content } = gh(`repos/${REPO}/contents/package.json?ref=${commit}`);
    return JSON.parse(Buffer.from(content, 'base64').toString('utf8')).version ?? null;
  } catch {
    return null;
  }
};
/** A full URL as given; a site path with or without the leading slash otherwise. */
const siteUrl = (value) => {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    log(
      `probe-url "${value}" looks like a Git-Bash-mangled path.\n` +
        'Pass it WITHOUT the leading slash (--probe-url release-notes.json), or set MSYS_NO_PATHCONV=1.',
    );
    process.exit(2);
  }
  return `${SITE}/${value.replace(/^\/+/, '')}`;
};
const explicitProbe = flag('probe');
const version = explicitProbe ? null : versionAt(sha);
/** What "served" means: the explicit needle as a substring, else the version line. */
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const probe = explicitProbe ?? (version ? new RegExp(`"current"\\s*:\\s*"${escapeRe(version)}"`) : null);
const probeUrl = siteUrl(flag('probe-url', explicitProbe ? 'i18n/de.json' : 'release-notes.json'));
if (!explicitProbe && !version) log('   no --probe and no package.json version at that commit — deployment status only');
const timeoutMs = Number(flag('timeout', '900')) * 1000;
const intervalMs = Number(flag('interval', '30')) * 1000;

/**
 * The deployment for THIS sha, or null. An empty list is a negative result, not
 * "still building": a production build can be skipped, rate-limited away, or
 * never start — that is exactly how #534 looked while it was already lost.
 */
function deploymentFor(commit) {
  const deployments = gh(
    `repos/${REPO}/deployments?sha=${commit}&environment=Production&per_page=10`,
  );
  if (!deployments.length) return null;
  const deployment = deployments[0];
  const statuses = gh(`repos/${REPO}/deployments/${deployment.id}/statuses?per_page=10`);
  const latest = statuses[0];
  return {
    id: deployment.id,
    url: `https://github.com/${REPO}/deployments`,
    state: latest?.state ?? 'pending',
    target: latest?.environment_url ?? null,
  };
}

/** Content probe: the strongest confirmation, because it reads what is served. */
async function probeIsLive() {
  if (!probe) return null;
  const sep = probeUrl.includes('?') ? '&' : '?';
  try {
    const res = await fetch(`${probeUrl}${sep}ngsw-bypass=true`, { cache: 'no-store' });
    if (!res.ok) return false;
    const text = await res.text();
    return typeof probe === 'string' ? text.includes(probe) : probe.test(text);
  } catch (err) {
    log(`   probe failed: ${err.message}`);
    return false;
  }
}

const replyLive = (at, deployment) =>
  [
    `✅ Geshipped in ${pr}. Geändert: ${changed}`,
    '',
    `Live seit ${at} auf \`${SITE}${route}\` — das Production-Deployment für die`,
    `Merge-SHA \`${sha.slice(0, 7)}\` ist geprüft (${deployment.url}).`,
    '',
    'Siehst du noch den alten Stand: die Seite ist eine PWA und liefert dir zuerst',
    'den gecachten — einmal `Strg+Shift+R`, oder die Route mit `?ngsw-bypass=true`',
    'aufrufen.',
    '',
    'Passt etwas nicht, oder willst du weiter dran arbeiten? Antworte einfach hier',
    'im Thread — die Routine nimmt das Thema dann automatisch wieder auf.',
  ].join('\n');

const replyNotLive = (at, deployment) =>
  [
    `✅ Gemerged in ${pr}. Geändert: ${changed}`,
    '',
    deployment?.state === 'failure'
      ? `❌ Das Production-Deployment für \`${sha.slice(0, 7)}\` ist fehlgeschlagen (Stand ${at}, ${deployment.url}).`
      : `⏳ Das Production-Deployment für \`${sha.slice(0, 7)}\` ist noch nicht durch (Stand ${at}${deployment ? `, ${deployment.url}` : ', es existiert noch kein Deployment-Eintrag'}).`,
    'Ich schicke dich bewusst nicht auf eine Seite, auf der die Änderung noch nicht',
    'drauf ist — sobald es durch ist, melde ich mich hier.',
    '',
    'Passt etwas nicht, oder willst du weiter dran arbeiten? Antworte einfach hier',
    'im Thread — die Routine nimmt das Thema dann automatisch wieder auf.',
  ].join('\n');

/**
 * Sets `process.exitCode` and returns rather than calling `process.exit()`:
 * killing the process while `fetch`'s handle is still closing trips a libuv
 * assertion on Windows (`!(handle->flags & UV_HANDLE_CLOSING)`) and the shell
 * sees 127 — which would read as "the script is broken" on the very run that
 * verified the deploy correctly.
 */
async function main() {
  const started = Date.now();
  log(`verify-ship-live: ${sha.slice(0, 7)} → ${SITE}${route}`);
  if (probe) log(`   probe: ${typeof probe === 'string' ? JSON.stringify(probe) : probe} in ${probeUrl}`);

  let deployment = null;
  for (;;) {
    deployment = deploymentFor(sha);
    const served = await probeIsLive();
    log(
      `   ${hhmm()}  deployment=${deployment ? deployment.state : 'none'}` +
        (served === null ? '' : `  probe=${served ? 'hit' : 'miss'}`),
    );

    if (deployment?.state === 'success' && served !== false) {
      const at = hhmm();
      log(`   verified live at ${at}`);
      console.log(replyLive(at, deployment));
      process.exitCode = 0;
      return;
    }
    if (deployment?.state === 'failure') break;
    if (has('once') || Date.now() - started + intervalMs > timeoutMs) break;
    await sleep(intervalMs);
  }

  log(`   NOT verified live after ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(replyNotLive(hhmm(), deployment));
  process.exitCode = 1;
}

await main();
