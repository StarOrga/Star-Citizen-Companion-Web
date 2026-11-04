/**
 * Startup profiler for the built app (docs/performance-plan.md).
 *
 * Serves a production build, fakes a signed-in, approved session and answers
 * every Supabase / third-party request from fixtures.cjs, then loads ONE route
 * and reports FCP/LCP, long tasks, request counts, running CSS animations and
 * (with --profile) a CPU profile resolved through the source maps to
 * src/ files and functions.
 *
 *   npx ng build --source-map --output-path=/tmp/perf-build
 *   NODE_PATH=$(npm root -g) node scripts/perf/profile-startup.cjs /tmp/perf-build/browser /verse --beta --profile
 *
 * Flags: --beta (verse+shell+codex beta on), --de (German locale), --secs=N,
 * --profile (CPU profile), --reqs (request list), --warm (load once before).
 * Needs `playwright` (preinstalled in claude.ai cloud sessions; otherwise
 * `npm i -g playwright`). WebGL runs on SwiftShader here, so GPU-heavy numbers
 * are pessimistic; JS/main-thread numbers are the reliable part.
 */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const { SourceMapConsumer } = require(path.resolve(__dirname, '../../node_modules/source-map'));
const fx = require('./fixtures.cjs');
const [root, route, ...flags] = process.argv.slice(2);
const has = (f) => flags.includes(f), opt = (k, d) => (flags.find((f) => f.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.map': 'application/json', '.wasm': 'application/wasm' };
const server = http.createServer((q, r) => { let p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html'); r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(r); });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const uid = '00000000-0000-4000-8000-000000000001', t = Math.floor(Date.now() / 1000);
const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 't@example.com', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const session = { access_token: b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub: uid, role: 'authenticated', exp: t + 86400, aud: 'authenticated' }) + '.sig', refresh_token: 'r', token_type: 'bearer', expires_in: 86400, expires_at: t + 86400, user };
// Any image request gets the repo's OG card — real bytes, so decode/layout costs are real.
const stubImage = fs.readFileSync(path.resolve(__dirname, '../../public/icons/brand/scc-og-1200x630.png'));
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, locale: has('--de') ? 'de-DE' : 'en-US' });
  await ctx.addInitScript(([s, beta]) => {
    if (!localStorage.getItem('sc.auth')) localStorage.setItem('sc.auth', s);
    if (beta) localStorage.setItem('sc.beta', JSON.stringify({ verse: true, shell: true, codex: true }));
    window.__lt = []; window.__lcp = 0;
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = Math.round(e.startTime)))).observe({ type: 'largest-contentful-paint', buffered: true });
  }, [JSON.stringify(session), has('--beta')]);
  const page = await ctx.newPage();
  const reqs = []; const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1).*/, (rt) => {
    const r = rt.request(), u = r.url(), d = decodeURIComponent(u);
    reqs.push(r.method() + ' ' + d.replace(/^https:\/\/hcnqhvzlavdycidqyaai\.supabase\.co/, 'SB').replace(/\?.*/, '').slice(0, 110));
    const json = (o) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(u) || u.includes('/news-images/') || u.includes('ytimg')) return rt.fulfill({ status: 200, contentType: 'image/png', body: stubImage });
    if (u.includes('fonts.g')) return rt.fulfill({ status: 404, body: '' });
    if (u.includes('/auth/v1/user')) return json(user);
    if (u.includes('fetch-verse-news')) return json(fx.feed);
    if (u.includes('rpc/verse_digest')) return json(fx.digest);
    if (u.includes('/rest/v1/profiles') && d.includes('is_approved')) return json({ role: 'user', is_approved: true });
    if (u.includes('/rest/v1/verse_wallpapers')) return json(fx.wallpapers);
    if (u.includes('/rest/v1/codex_builds')) return (r.headers()['accept'] || '').includes('vnd.pgrst.object') ? json(fx.build) : json([fx.build]);
    const single = (r.headers()['accept'] || '').includes('vnd.pgrst.object');
    return rt.fulfill({ status: 200, contentType: 'application/json', body: single ? 'null' : '[]' });
  });
  if (has('--warm')) { await page.goto(base + route); await page.waitForTimeout(4000); }
  const cdp = await ctx.newCDPSession(page);
  if (has('--profile')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  reqs.length = 0;
  await page.goto(base + route, { waitUntil: 'commit' });
  await page.waitForTimeout(+opt('secs', 8) * 1000);
  const info = await page.evaluate(() => ({ lt: window.__lt, lcp: window.__lcp, fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0),
    marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('sc-')).map((m) => m.name + '@' + Math.round(m.startTime)),
    dom: document.getElementsByTagName('*').length, heap: Math.round(performance.memory.usedJSHeapSize / 1e6), path: location.pathname,
    res: performance.getEntriesByType('resource').filter((e) => e.name.startsWith(location.origin)).length, i18n: performance.getEntriesByType('resource').filter((e) => e.name.includes('/i18n/')).map((e) => e.name.replace(/^.*\/i18n\//, '') + '@' + Math.round(e.startTime) + '-' + Math.round(e.responseEnd)) }));
  const anims = await page.evaluate(() => document.getAnimations().map((a) => { const e = a.effect; const t = e && e.target; const kf = e && e.getKeyframes ? e.getKeyframes() : [];
  const props = [...new Set(kf.flatMap((k) => Object.keys(k).filter((p) => !['offset','computedOffset','easing','composite'].includes(p))))];
  const r = t && t.getBoundingClientRect ? t.getBoundingClientRect() : null;
  return { name: a.animationName || a.transitionProperty || a.constructor.name, it: e && e.getTiming().iterations, state: a.playState, props: props.join(','),
    el: t ? (t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.trim().split(/\s+/).slice(0,2).join('.') : '') + (t.parentElement ? ' < ' + t.parentElement.tagName.toLowerCase() : '')) : '-', size: r ? Math.round(r.width) + 'x' + Math.round(r.height) : '', vis: r ? (r.bottom > 0 && r.top < innerHeight) : null }; }));
  console.log('  RUNNING ANIMATIONS:', anims.length); anims.filter(a=>a.state==='running').forEach((a) => console.log('   ', a.name, 'it=' + a.it, '[' + a.props + ']', a.el, a.size, a.vis ? 'visible' : 'offscreen'));
  const ltSum = info.lt.reduce((a, x) => a + x[1], 0);
  console.log(`ROUTE ${route} -> ${info.path} beta=${has('--beta')} de=${has('--de')} | FCP ${info.fcp} LCP ${info.lcp} | longtasks ${info.lt.length} sum ${ltSum}ms max ${Math.max(0, ...info.lt.map((x) => x[1]))} | dom ${info.dom} heap ${info.heap}MB | localRes ${info.res} ext ${reqs.length}`);
  console.log('  longtasks@', info.lt.map((x) => x[0] + ':' + x[1]).join(' '));
  console.log('  marks', info.marks.join(' '), '| i18n', (info.i18n||[]).join(' '));
  if (errors.length) console.log('  pageerrors', errors.slice(0, 3));
  if (has('--reqs')) { const c = {}; reqs.forEach((u) => (c[u] = (c[u] || 0) + 1)); Object.entries(c).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(5), k)); }
  if (has('--profile')) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => self.set(id, (self.get(id) || 0) + (dt[i] || 0)));
    const consumers = new Map();
    const agg = new Map(), aggFile = new Map();
    for (const [id, us] of self) {
      const n = byId.get(id), cf = n.callFrame; let key = cf.functionName || '(anon)', file = cf.url.replace(/^.*\//, '') || cf.functionName;
      if (cf.url.startsWith(base) && cf.url.endsWith('.js')) {
        const f = path.join(root, cf.url.slice(base.length)); const mp = f + '.map';
        if (fs.existsSync(mp)) {
          if (!consumers.has(mp)) consumers.set(mp, await new SourceMapConsumer(JSON.parse(fs.readFileSync(mp, 'utf8'))));
          const pos = consumers.get(mp).originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber });
          if (pos.source) { file = pos.source.replace(/^.*?(src\/|node_modules\/)/, '$1'); key = (pos.name || cf.functionName || '?'); }
        }
      }
      const k = file + ' :: ' + key; agg.set(k, (agg.get(k) || 0) + us); aggFile.set(file, (aggFile.get(file) || 0) + us);
    }
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `  ${(v / 1000).toFixed(0).padStart(6)}ms ${k}`).join('\n');
    console.log(' TOP FILES (self time)\n' + top(aggFile, 22)); console.log(' TOP FUNCS\n' + top(agg, 25));
  }
  await b.close(); server.close();
})().catch((e) => { console.error(e); process.exit(1); });
