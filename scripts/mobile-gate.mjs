#!/usr/bin/env node
/**
 * Mobile & tablet responsive gate.
 *
 * Drives a real Chrome/Edge over the DevTools Protocol, emulates iOS + Android
 * phone and tablet devices, walks the app's public routes and asserts a set of
 * machine-checkable mobile-usability rules. Exits non-zero when any `error`
 * severity rule is violated, so it can gate `/ship`.
 *
 * Usage:
 *   node scripts/mobile-gate.mjs                       # auto: running dev server, else dist/
 *   node scripts/mobile-gate.mjs --base-url=https://sc-companion.vercel.app
 *   node scripts/mobile-gate.mjs --quick               # 2 devices x the public routes
 *   node scripts/mobile-gate.mjs --routes=/about,/login --devices=iphone-14
 *   node scripts/mobile-gate.mjs --json=mobile-gate.json --screenshots=.mobile-gate
 *   node scripts/mobile-gate.mjs --selftest           # prove every check still fires
 *   node scripts/mobile-gate.mjs --auth                # + the signed-in routes and panels
 *
 * `--routes` narrows the PUBLIC pass only — it never reaches `auth.routes`, so
 * a gated route cannot be singled out that way; narrow by `--devices` instead.
 *   node scripts/mobile-gate.mjs --skip-if-unavailable # exit 0 + SKIPPED when no Chromium exists
 *
 * Exit codes: 0 green · 1 blocking findings (gate failed) · 2 could not run.
 *
 * `--auth` adds an opt-in authenticated pass (#516). Public routes alone leave
 * the feedback panels — the admin board and the viewer panel, both full-bleed
 * sheets below 720px — completely unaudited, so the gate could report GREEN
 * without ever having seen them. With `--auth` the gate signs a test user in
 * through the app's own login form and then audits `auth.routes` plus the FAB
 * panel opened on top of `auth.panelRoutes`.
 *
 * Credentials come from the environment, never from the repo:
 *   SC_GATE_EMAIL / SC_GATE_PASSWORD   — a dedicated test account
 * Without them `--auth` exits 2 rather than quietly auditing nothing.
 *
 * No npm dependencies: uses node:http, the built-in WebSocket client and a
 * locally installed Chrome/Edge binary.
 *
 * Docs: docs/mobile-gate.md
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG_PATH = join(REPO_ROOT, 'scripts', 'mobile-gate.config.json');

// ---------------------------------------------------------------------------
// Device profiles
// ---------------------------------------------------------------------------

const UA_IOS_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IOS_TABLET =
  'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_ANDROID_TABLET =
  'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const DEVICES = {
  'iphone-14': {
    id: 'iphone-14', label: 'iPhone 14 / 15', os: 'iOS', form: 'phone',
    width: 390, height: 844, dpr: 3, ua: UA_IOS_PHONE, platform: 'iPhone',
  },
  'iphone-se': {
    id: 'iphone-se', label: 'iPhone SE', os: 'iOS', form: 'phone',
    width: 375, height: 667, dpr: 2, ua: UA_IOS_PHONE, platform: 'iPhone',
  },
  'pixel-7': {
    id: 'pixel-7', label: 'Pixel 7', os: 'Android', form: 'phone',
    width: 393, height: 851, dpr: 2.625, ua: UA_ANDROID_PHONE, platform: 'Linux armv8l',
  },
  'ipad-air': {
    id: 'ipad-air', label: 'iPad Air', os: 'iOS', form: 'tablet',
    width: 820, height: 1180, dpr: 2, ua: UA_IOS_TABLET, platform: 'iPad',
  },
  'galaxy-tab-s9': {
    id: 'galaxy-tab-s9', label: 'Galaxy Tab S9', os: 'Android', form: 'tablet',
    width: 800, height: 1280, dpr: 2, ua: UA_ANDROID_TABLET, platform: 'Linux armv8l',
  },
};

const DEFAULT_CONFIG = {
  baseUrl: null,
  devices: ['iphone-14', 'pixel-7', 'ipad-air', 'galaxy-tab-s9'],
  quickDevices: ['iphone-14', 'ipad-air'],
  routes: ['/news', '/codex', '/codex/index', '/starscape', '/hangar', '/login', '/about'],
  quickRoutes: ['/news', '/codex', '/hangar', '/about'],
  thresholds: { minTapTargetPx: 44, minFontSizePx: 12, overflowTolerancePx: 1, maxFindingsPerCheck: 8 },
  severity: {
    'horizontal-overflow': 'error',
    'tap-target-too-small': 'error',
    'text-too-small': 'error',
    'content-clipped': 'error',
    'overlapping-content': 'error',
    'fixed-overlay-covers-control': 'error',
    'viewport-meta': 'error',
    'auth-redirect': 'error',
    'console-error': 'error',
    'network-error': 'warn',
  },
  ignore: { selectors: {}, consolePatterns: [], routes: [] },
  timing: { navigationTimeoutMs: 45000, settleMs: 900, scrollSettleMs: 350, maxScrollSteps: 8 },
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { flags: new Set(), opts: {} };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [k, ...rest] = raw.slice(2).split('=');
    if (rest.length) out.opts[k] = rest.join('=');
    else out.flags.add(k);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.flags.has('help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?|^ \* ?/gm, ''));
  process.exit(0);
}

function loadConfig() {
  let cfg = structuredClone(DEFAULT_CONFIG);
  if (existsSync(CONFIG_PATH)) {
    try {
      const user = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      cfg = deepMerge(cfg, user);
    } catch (err) {
      fail(`mobile-gate.config.json is not valid JSON: ${err.message}`);
    }
  }
  return cfg;
}

function deepMerge(base, patch) {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch) || typeof patch !== 'object') return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function fail(msg) {
  console.error(`\n[mobile-gate] ${msg}\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Chrome discovery + launch
// ---------------------------------------------------------------------------

function findBrowser() {
  const explicit = process.env.MOBILE_GATE_CHROME || process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

async function launchBrowser({ headless }) {
  const bin = findBrowser();
  if (!bin) {
    fail(
      'No Chrome/Edge binary found. Install Google Chrome or set CHROME_BIN / MOBILE_GATE_CHROME to a Chromium binary.',
    );
  }
  const profileDir = join(tmpdir(), `mobile-gate-${process.pid}-${Date.now()}`);
  mkdirSync(profileDir, { recursive: true });
  const flags = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-dev-shm-usage',
    '--disable-features=Translate,MediaRouter,OptimizationHints',
    '--mute-audio',
    '--hide-scrollbars',
    'about:blank',
  ];
  if (headless) flags.unshift('--headless=new', '--disable-gpu');
  const proc = spawn(bin, flags, { stdio: 'ignore', windowsHide: true });
  proc.on('error', (err) => fail(`Failed to launch browser: ${err.message}`));

  const portFile = join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const raw = readFileSync(portFile, 'utf8').split('\n');
      if (raw.length >= 2 && raw[0].trim()) {
        return {
          bin,
          proc,
          wsUrl: `ws://127.0.0.1:${raw[0].trim()}${raw[1].trim()}`,
          close() {
            try { proc.kill(); } catch { /* already gone */ }
            setTimeout(() => { try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ } }, 500);
          },
        };
      }
    }
    await sleep(120);
  }
  fail('Browser did not expose a DevTools port within 30s.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Minimal CDP client (flat sessions)
// ---------------------------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => this.#onMessage(String(ev.data)));
    ws.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => res(new Cdp(ws)));
      ws.addEventListener('error', () => rej(new Error(`Cannot connect to ${url}`)));
    });
  }

  #onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    const key = `${msg.sessionId || ''}|${msg.method}`;
    for (const h of this.handlers.get(key) || []) h(msg.params || {});
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out after 60s`));
        }
      }, 60000);
    });
  }

  on(sessionId, method, handler) {
    const key = `${sessionId || ''}|${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, []);
    this.handlers.get(key).push(handler);
  }

  close() { try { this.ws.close(); } catch { /* noop */ } }
}

// ---------------------------------------------------------------------------
// In-page audit (serialised into the page — keep it self-contained)
// ---------------------------------------------------------------------------

/* eslint-disable */
function pageAudit(opts) {
  const MAX = opts.maxFindingsPerCheck;
  const TOL = opts.overflowTolerancePx;
  const findings = [];
  const counts = {};
  const dedupe = new Set();

  const INTERACTIVE =
    'a[href],button,input:not([type="hidden"]),select,textarea,summary,' +
    '[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],' +
    '[contenteditable="true"],[tabindex]:not([tabindex="-1"])';

  function add(check, message, el, extra) {
    const selector = el ? cssPath(el) : null;
    const key = check + '|' + selector + '|' + (extra && extra.detail ? extra.detail : message);
    if (dedupe.has(key)) return;
    dedupe.add(key);
    counts[check] = (counts[check] || 0) + 1;
    if (counts[check] > MAX) return;
    findings.push(Object.assign({ check: check, message: message, selector: selector }, extra || {}));
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function label(el) {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    return t.length > 48 ? t.slice(0, 45) + '…' : t;
  }

  function rendered(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('[aria-hidden="true"],[inert]')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    if (parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  }

  function clippedByAncestor(el) {
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
      const cs = getComputedStyle(node);
      if (cs.overflowX !== 'visible' || cs.contain.indexOf('paint') !== -1) return true;
      if (cs.position === 'fixed') return true;
      node = node.parentElement;
    }
    return false;
  }

  // --- 1. viewport meta -----------------------------------------------------
  const meta = document.querySelector('meta[name="viewport"]');
  const content = meta ? meta.getAttribute('content') || '' : '';
  if (!meta || content.indexOf('width=device-width') === -1) {
    add('viewport-meta', 'missing <meta name="viewport" content="width=device-width…">', null, { detail: content });
  } else if (/user-scalable\s*=\s*(no|0)/i.test(content) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(content)) {
    add('viewport-meta', 'viewport meta blocks pinch-zoom (user-scalable=no / maximum-scale=1)', null, { detail: content });
  }

  // --- 2. horizontal overflow ----------------------------------------------
  const vw = window.innerWidth;
  const de = document.documentElement;
  const pageW = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);
  // Ground truth: can the user actually drag the page sideways? A wide
  // scrollWidth that is fully clipped is not a defect the user can feel.
  let reachedX = 0;
  if (pageW > vw + TOL) {
    const beforeX = window.scrollX;
    const beforeY = window.scrollY;
    try { window.scrollTo({ left: vw * 3, top: beforeY, behavior: 'instant' }); } catch (e) { window.scrollTo(vw * 3, beforeY); }
    reachedX = Math.round(window.scrollX);
    try { window.scrollTo({ left: beforeX, top: beforeY, behavior: 'instant' }); } catch (e) { window.scrollTo(beforeX, beforeY); }
  }
  if (reachedX > TOL) {
    add('horizontal-overflow', 'the page really scrolls sideways by ' + reachedX + 'px (content ' + Math.round(pageW) + 'px in a ' + vw + 'px viewport)', null, {
      detail: 'page', measured: Math.round(pageW), limit: vw, scrollX: reachedX,
    });
    const offenders = [];
    const suspects = [];
    const all = document.body ? [document.body].concat(Array.prototype.slice.call(document.body.querySelectorAll('*'))) : [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (!rendered(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') continue;
      const r = el.getBoundingClientRect();
      const wide = r.right > vw + TOL || r.left < -TOL || el.scrollWidth > vw + TOL;
      if (!wide) continue;
      if (r.right > vw + TOL || r.left < -TOL) {
        if (clippedByAncestor(el)) suspects.push(el);
        else offenders.push(el);
      } else {
        suspects.push(el); // clipped scroller that is itself wider than the viewport
      }
    }
    if (!offenders.length && suspects.length) {
      // Nothing sticks out un-clipped — name the widest boxes as the likely cause.
      suspects.sort(function (a, b) { return b.scrollWidth - a.scrollWidth; });
      for (let i = 0; i < Math.min(3, suspects.length); i++) {
        const el = suspects[i];
        add('horizontal-overflow', 'possible cause: this box is ' + el.scrollWidth + 'px wide (viewport ' + vw + 'px)', el, {
          detail: 'suspect', measured: el.scrollWidth, limit: vw, text: label(el),
        });
      }
    }
    for (let i = 0; i < offenders.length; i++) {
      const el = offenders[i];
      let hasChildOffender = false;
      for (let j = 0; j < offenders.length; j++) {
        if (offenders[j] !== el && el.contains(offenders[j])) { hasChildOffender = true; break; }
      }
      if (hasChildOffender) continue;
      const r = el.getBoundingClientRect();
      add('horizontal-overflow', 'element sticks out to x=' + Math.round(r.right) + 'px (viewport ' + vw + 'px)', el, {
        detail: 'element', measured: Math.round(r.right), limit: vw, text: label(el),
      });
    }
  }

  // --- 3. tap targets -------------------------------------------------------
  const MIN_TAP = opts.minTapTargetPx;
  const controls = document.querySelectorAll(INTERACTIVE);
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i];
    if (el.disabled) continue;
    if (!rendered(el)) continue;
    let r = el.getBoundingClientRect();
    // Off-canvas (closed drawer / carousel slide out of frame) → not a live target.
    if (r.right < -8 || r.left > vw + 8) continue;
    // Material-style expanded hit areas count as the real target.
    const touch = el.querySelector('[class*="touch-target"]');
    if (touch) {
      const tr = touch.getBoundingClientRect();
      if (tr.width > r.width || tr.height > r.height) r = tr;
    }
    // Inline links inside running prose are text, not controls.
    const cs = getComputedStyle(el);
    if (el.tagName === 'A' && cs.display === 'inline') {
      const p = el.parentElement;
      const own = (el.textContent || '').trim().length;
      if (p && (p.textContent || '').trim().length > own + 10) continue;
    }
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (Math.min(w, h) >= MIN_TAP - 0.5) continue;
    add('tap-target-too-small', 'tap target is ' + w + '×' + h + 'px (min ' + MIN_TAP + '×' + MIN_TAP + ')', el, {
      detail: w + 'x' + h, measured: Math.min(w, h), limit: MIN_TAP, text: label(el),
    });
  }

  // --- 4. text too small ----------------------------------------------------
  const MIN_FS = opts.minFontSizePx;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      const txt = (n.nodeValue || '').trim();
      if (txt.length < 2) continue;
      const p = n.parentElement;
      if (!p) continue;
      if (p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.tagName === 'NOSCRIPT' || p.tagName === 'TEMPLATE') continue;
      if (!rendered(p)) continue;
      const fs = parseFloat(getComputedStyle(p).fontSize);
      if (!(fs < MIN_FS - 0.01)) continue;
      add('text-too-small', 'font-size ' + fs + 'px is below the ' + MIN_FS + 'px readable minimum', p, {
        detail: String(fs), measured: fs, limit: MIN_FS, text: txt.slice(0, 40),
      });
    }
  }

  // --- 5. clipped content ---------------------------------------------------
  const boxes = document.body ? document.body.querySelectorAll('*') : [];
  for (let i = 0; i < boxes.length; i++) {
    const el = boxes[i];
    if (!rendered(el)) continue;
    let ownText = '';
    for (let c = 0; c < el.childNodes.length; c++) {
      const node = el.childNodes[c];
      if (node.nodeType === 3) ownText += node.nodeValue;
    }
    if (ownText.trim().length < 2) continue;
    const cs = getComputedStyle(el);
    const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
    const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
    const intentional = cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none');
    if (clipX && !intentional && el.scrollWidth > el.clientWidth + 2) {
      add('content-clipped', 'text is cut off horizontally (' + el.scrollWidth + 'px in ' + el.clientWidth + 'px, no ellipsis)', el, {
        detail: 'x', measured: el.scrollWidth, limit: el.clientWidth, text: ownText.trim().slice(0, 40),
      });
    } else if (clipY && !intentional && el.scrollHeight > el.clientHeight + 4) {
      add('content-clipped', 'text is cut off vertically (' + el.scrollHeight + 'px in ' + el.clientHeight + 'px)', el, {
        detail: 'y', measured: el.scrollHeight, limit: el.clientHeight, text: ownText.trim().slice(0, 40),
      });
    }
  }

  return { findings: findings, counts: counts, pageWidth: Math.round(pageW), viewportWidth: vw };
}

function pageOcclusionAudit(opts) {
  const findings = [];
  const dedupe = new Set();
  const INTERACTIVE =
    'a[href],button,input:not([type="hidden"]),select,textarea,summary,' +
    '[role="button"],[role="link"],[role="tab"],[role="switch"],[role="checkbox"],[role="radio"],[role="menuitem"],' +
    '[tabindex]:not([tabindex="-1"])';

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += '.' + cls.join('.');
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }
  function label(el) {
    const t = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
    return t.length > 40 ? t.slice(0, 37) + '…' : t;
  }

  // An open modal/overlay legitimately covers the page behind it.
  const overlay = document.querySelector(
    'dialog[open],[role="dialog"]:not([aria-hidden="true"]),[role="alertdialog"],.cdk-overlay-pane,.cdk-global-scrollblock',
  );
  if (overlay) return { findings: findings, skipped: 'overlay-open' };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const controls = document.querySelectorAll(INTERACTIVE);
  for (let i = 0; i < controls.length; i++) {
    const el = controls[i];
    if (el.disabled) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"],[inert]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom <= 2 || r.top >= vh - 2 || r.right <= 2 || r.left >= vw - 2) continue;
    const cx = Math.min(Math.max(r.left + r.width / 2, 2), vw - 2);
    const cy = Math.min(Math.max(r.top + r.height / 2, 2), vh - 2);
    if (cy < r.top - 1 || cy > r.bottom + 1) continue; // center scrolled out of view
    const top = document.elementFromPoint(cx, cy);
    if (!top || top === el || el.contains(top) || top.contains(el)) continue;
    let anc = top;
    let kind = 'overlapping-content';
    let coverer = top;
    while (anc && anc !== document.documentElement) {
      const pos = getComputedStyle(anc).position;
      if (pos === 'fixed' || pos === 'sticky') { kind = 'fixed-overlay-covers-control'; coverer = anc; break; }
      anc = anc.parentElement;
    }
    const key = kind + '|' + cssPath(el);
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    findings.push({
      check: kind,
      message:
        (kind === 'fixed-overlay-covers-control' ? 'fixed/sticky element ' : 'another element ') +
        '"' + cssPath(coverer) + '" covers this control at its center point',
      selector: cssPath(el),
      text: label(el),
      detail: cssPath(coverer),
      scrollY: Math.round(window.scrollY),
    });
    if (findings.length >= opts.maxFindingsPerCheck * 2) break;
  }
  return { findings: findings, skipped: null };
}
/* eslint-enable */

// ---------------------------------------------------------------------------
// Static file server (serves the production build when no dev server is up)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

/**
 * Resolve a request path against the served root, or null when it escapes it.
 * The request path is attacker-controlled (even on 127.0.0.1), so it is
 * decoded, rejected on NUL / `..` segments, normalised, and the resolved
 * candidate must still live inside `root`.
 */
function safeResolve(root, requestUrl) {
  const raw = (requestUrl || '/').split('?')[0].split('#')[0];
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  // Treat both separators as separators so `..` cannot hide behind a backslash.
  const unified = '/' + decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  if (unified.split('/').includes('..')) return null;
  const normalised = normalize(unified).replace(/\\/g, '/');
  if (normalised.split('/').includes('..')) return null;
  const file = resolve(root, '.' + normalised);
  if (file !== root && !file.startsWith(root + sep)) return null;
  return { file: file, path: normalised };
}

function startStaticServer(rootDir, port) {
  const root = resolve(rootDir);
  return new Promise((res, rej) => {
    const server = createServer((req, resp) => {
      const safe = safeResolve(root, req.url);
      if (!safe) {
        resp.writeHead(404).end('not found');
        return;
      }
      let file = safe.file;
      try {
        if (existsSync(file) && statSync(file).isFile()) {
          // serve as-is
        } else if (extname(safe.path)) {
          resp.writeHead(404).end('not found');
          return;
        } else {
          file = join(root, 'index.html');
        }
        resp.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
        createReadStream(file).pipe(resp);
      } catch {
        resp.writeHead(404).end('not found');
      }
    });
    server.on('error', rej);
    server.listen(port, '127.0.0.1', () => res({ server, url: `http://127.0.0.1:${port}`, close: () => server.close() }));
  });
}

async function probe(url, timeoutMs = 2500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/** Self-test: serve the fixture page that violates every check on purpose. */
async function startFixtureServer() {
  const dir = join(tmpdir(), `mobile-gate-fixture-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), readFileSync(join(REPO_ROOT, 'scripts', 'mobile-gate.fixture.html')));
  const srv = await startStaticServer(dir, Number(args.opts.port || 4272));
  return { baseUrl: srv.url, mode: 'self-test fixture', stop: () => { srv.close(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } } };
}

async function resolveTarget(cfg) {
  if (args.flags.has('selftest')) return startFixtureServer();
  const explicit = args.opts['base-url'] || process.env.MOBILE_GATE_BASE_URL || cfg.baseUrl;
  if (explicit) {
    const base = explicit.replace(/\/$/, '');
    if (!(await probe(base + '/', 8000))) fail(`--base-url ${base} is not reachable.`);
    return { baseUrl: base, mode: 'external', stop: null };
  }
  const dev = 'http://127.0.0.1:4200';
  if (await probe(dev + '/')) return { baseUrl: dev, mode: 'running dev server', stop: null };

  const dist = join(REPO_ROOT, 'dist', 'sc-companion', 'browser');
  if (!existsSync(join(dist, 'index.html'))) {
    fail(
      'Nothing to test against.\n' +
        '  • start the dev server (`npm start`), or\n' +
        '  • run `npm run build` so dist/sc-companion/browser exists, or\n' +
        '  • pass --base-url=<url> (e.g. a preview deployment).',
    );
  }
  const port = Number(args.opts.port || 4271);
  const srv = await startStaticServer(dist, port);
  return { baseUrl: srv.url, mode: 'static dist/', stop: () => srv.close() };
}

// ---------------------------------------------------------------------------
// Per-device run
// ---------------------------------------------------------------------------

/**
 * Sign a test user in through the app's own login form (#516).
 *
 * Deliberately the real form rather than an injected Supabase session: the
 * point of the authenticated pass is that a real sign-in on a phone works, and
 * a hand-forged localStorage entry would skip exactly the code that could be
 * broken. Values go in through the native setter plus `input`/`change` events —
 * Angular's reactive forms listen for those, not for a plain `.value =`.
 *
 * Never logs, echoes or stores the password.
 */
async function signIn(cdp, sessionId, baseUrl, creds, state, cfg) {
  await navigate(cdp, sessionId, baseUrl + '/login', state, cfg);
  const pre = await evaluate(cdp, sessionId, `(() => {
    const email = document.querySelector('input[type="email"]');
    const pass = document.querySelector('input[type="password"]');
    const submit = document.querySelector('form button[type="submit"]');
    if (!email || !pass || !submit) return { ok: false, why: 'login form not found' };
    const set = (el, v) => {
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      d.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(email, ${JSON.stringify(creds.email)});
    set(pass, ${JSON.stringify(creds.password)});
    return { ok: true };
  })()`, true);
  if (!pre || !pre.ok) throw new Error((pre && pre.why) || 'could not reach the login form');

  // Angular keeps submit disabled until the form is valid; give it a tick.
  await sleep(cfg.timing.scrollSettleMs);
  await evaluate(cdp, sessionId, `document.querySelector('form button[type="submit"]').click()`, true);

  const deadline = Date.now() + cfg.timing.navigationTimeoutMs;
  for (;;) {
    await sleep(cfg.timing.scrollSettleMs);
    const where = await evaluate(cdp, sessionId, `(() => ({
      path: location.pathname,
      err: (document.querySelector('form .err') || {}).textContent || null,
    }))()`, true);
    if (where && where.err) throw new Error(`sign-in rejected: ${String(where.err).trim().slice(0, 160)}`);
    if (where && where.path && !where.path.startsWith('/login')) return where.path;
    if (Date.now() > deadline) throw new Error('sign-in did not leave /login before the navigation timeout');
  }
}

/** Open the feedback FAB, so the panel itself is audited and not just its launcher. */
async function openFeedbackPanel(cdp, sessionId, cfg) {
  const opened = await evaluate(cdp, sessionId, `(() => {
    const fab = document.querySelector('sc-feedback-fab .fab, sc-user-feedback-fab .fab');
    if (!fab) return { ok: false, why: 'no feedback FAB on this route' };
    if (fab.classList.contains('is-open')) return { ok: true };
    fab.click();
    return { ok: true };
  })()`, true);
  if (!opened || !opened.ok) throw new Error((opened && opened.why) || 'feedback FAB not reachable');
  await sleep(cfg.timing.settleMs);
  const visible = await evaluate(cdp, sessionId, `!!document.querySelector('.panel:not(.minimized)')`, true);
  if (!visible) throw new Error('feedback panel did not become visible after the tap');
}

async function runDevice(cdp, device, routes, baseUrl, cfg, screenshotDir, auth = null) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const state = { console: [], network: [], inflight: 0, lastActivity: Date.now() };

  cdp.on(sessionId, 'Runtime.consoleAPICalled', (p) => {
    if (p.type !== 'error' && p.type !== 'assert') return;
    state.console.push({ kind: 'console.' + p.type, text: (p.args || []).map(argToText).join(' ').slice(0, 400) });
  });
  cdp.on(sessionId, 'Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'uncaught exception';
    state.console.push({ kind: 'exception', text: String(text).slice(0, 400) });
  });
  cdp.on(sessionId, 'Log.entryAdded', (p) => {
    const e = p.entry || {};
    if (e.level !== 'error') return;
    if (e.source === 'network') state.network.push({ kind: 'network', text: `${e.text} ${e.url || ''}`.slice(0, 400) });
    else state.console.push({ kind: 'log.' + e.source, text: `${e.text} ${e.url || ''}`.slice(0, 400) });
  });
  cdp.on(sessionId, 'Network.requestWillBeSent', () => { state.inflight++; state.lastActivity = Date.now(); });
  cdp.on(sessionId, 'Network.loadingFinished', () => { state.inflight--; state.lastActivity = Date.now(); });
  cdp.on(sessionId, 'Network.loadingFailed', (p) => {
    state.inflight--; state.lastActivity = Date.now();
    if (p.canceled) return;
    state.network.push({ kind: 'request-failed', text: `${p.errorText} (${p.type})` });
  });
  cdp.on(sessionId, 'Network.responseReceived', (p) => {
    if (p.response && p.response.status >= 400) {
      state.network.push({ kind: 'http-' + p.response.status, text: `${p.response.status} ${p.response.url}`.slice(0, 300) });
    }
  });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: device.width, height: device.height, deviceScaleFactor: device.dpr, mobile: true,
    screenWidth: device.width, screenHeight: device.height,
    screenOrientation: { type: 'portraitPrimary', angle: 0 },
  }, sessionId);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: device.ua, platform: device.platform, acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  }, sessionId);

  const results = [];

  /**
   * Navigate to one route and run the full audit on it. `prepare` runs after
   * the page has loaded and before anything is measured — that is where the
   * authenticated pass opens the feedback panel, so the sheet is what gets
   * audited rather than the page behind it. `label` names the row in the
   * report when it is not simply the route.
   */
  const auditRoute = async (route, { prepare = null, label = null } = {}) => {
    state.console.length = 0;
    state.network.length = 0;
    state.inflight = 0;
    const url = baseUrl + route;
    const result = { device: device.id, route: label || route, path: route, url, findings: [], error: null, finalUrl: null };
    try {
      await navigate(cdp, sessionId, url, state, cfg);

      // The app is a login wall by default (app.routes.ts hangs
      // `canActivateChild: [...PRIVATE]` on the shell), so a route we hold no
      // session for does not fail here — it quietly becomes /login. Every
      // check below would then measure a perfectly fine login form and pass.
      // That is how a run reports "40 page audits · 0 blocking findings ·
      // GREEN" without once having rendered the page it named. Ask where we
      // landed BEFORE measuring, and skip a measurement that cannot mean
      // anything — login-page findings filed under the ship page's name are
      // worse than no findings.
      result.finalUrl = await evaluate(cdp, sessionId, 'location.pathname + location.search');
      const landed = authRedirect(route, result.finalUrl);
      if (landed) {
        result.findings.push({
          check: 'auth-redirect',
          message: `asked for ${route}, rendered ${landed} — nothing on this route was audited`,
          selector: null,
          detail: auth ? 'signed-in pass' : 'public pass — this route needs a session',
        });
        results.push(result);
        console.log(`  FAIL  ${device.id.padEnd(14)} ${result.route.padEnd(24)} auth-redirect`);
        return;
      }

      if (prepare) await prepare();
      // Sweep the page so sticky/fixed chrome is measured where it actually lands.
      const occlusionOpts = { maxFindingsPerCheck: cfg.thresholds.maxFindingsPerCheck };
      for (let step = 0; step < cfg.timing.maxScrollSteps; step++) {
        const scrolled = await evaluate(cdp, sessionId, `(() => {
          const stepPx = Math.round(window.innerHeight * 0.85);
          window.scrollTo(0, stepPx * ${step});
          return { y: window.scrollY, max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) };
        })()`);
        await sleep(cfg.timing.scrollSettleMs);
        const occ = await callInPage(cdp, sessionId, pageOcclusionAudit, occlusionOpts);
        for (const f of occ.findings) result.findings.push(f);
        if (!scrolled || scrolled.y >= scrolled.max - 2) break;
      }
      await evaluate(cdp, sessionId, 'window.scrollTo(0,0)');
      await sleep(cfg.timing.scrollSettleMs);

      const audit = await callInPage(cdp, sessionId, pageAudit, {
        minTapTargetPx: cfg.thresholds.minTapTargetPx,
        minFontSizePx: cfg.thresholds.minFontSizePx,
        overflowTolerancePx: cfg.thresholds.overflowTolerancePx,
        maxFindingsPerCheck: cfg.thresholds.maxFindingsPerCheck,
      });
      for (const f of audit.findings) result.findings.push(f);

      for (const c of dedupeMessages(state.console)) {
        result.findings.push({ check: 'console-error', message: c.text, selector: null, detail: c.kind });
      }
      for (const n of dedupeMessages(state.network)) {
        result.findings.push({ check: 'network-error', message: n.text, selector: null, detail: n.kind });
      }
    } catch (err) {
      result.error = err.message;
      result.findings.push({ check: 'console-error', message: `route did not load: ${err.message}`, selector: null, detail: 'navigation' });
    }

    result.findings = result.findings.filter((f) => !isIgnored(f, cfg));
    if (screenshotDir && result.findings.length) {
      const name = `${device.id}${route.replace(/[^a-z0-9]+/gi, '_')}.png`.replace(/__+/g, '_');
      try {
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
        writeFileSync(join(screenshotDir, name), Buffer.from(shot.data, 'base64'));
        result.screenshot = join(screenshotDir, name);
      } catch { /* screenshots are best effort */ }
    }
    results.push(result);
    const errs = result.findings.filter((f) => severityOf(f, cfg) === 'error').length;
    console.log(`  ${errs ? 'FAIL' : ' ok '}  ${device.id.padEnd(14)} ${result.route.padEnd(24)} ${errs ? errs + ' finding(s)' : ''}`);
  };

  for (const route of routes) await auditRoute(route);

  // ---- authenticated pass (#516) -----------------------------------------
  // Everything behind the shell's `canActivateChild: [...PRIVATE]` is invisible
  // to the public walk above — it does not fail there, it silently becomes
  // /login. So the signed-in routes run on EVERY device: a ship page that
  // breaks on a tablet breaks whether or not a login stands in front of it.
  //
  // The FAB panels stay phones-only, and for their own reason: above 720px
  // they are docked windows beside a page the public pass already measured,
  // so the full-bleed sheet layout under test does not exist there.
  const panelRoutes = device.width < 768 ? auth?.panelRoutes ?? [] : [];
  if (auth && ((auth.routes?.length ?? 0) || panelRoutes.length)) {
    try {
      await signIn(cdp, sessionId, baseUrl, auth.credentials, state, cfg);
      for (const route of auth.routes ?? []) await auditRoute(route);
      for (const route of panelRoutes) {
        await auditRoute(route, {
          label: `${route} [panel]`,
          prepare: () => openFeedbackPanel(cdp, sessionId, cfg),
        });
      }
    } catch (err) {
      // A broken sign-in must never read as "the panels are fine".
      results.push({
        device: device.id, route: '[auth]', url: baseUrl + '/login', finalUrl: null,
        error: err.message,
        findings: [{ check: 'console-error', message: `authenticated pass failed: ${err.message}`, selector: null, detail: 'auth' }],
      });
      console.log(`  FAIL  ${device.id.padEnd(14)} ${'[auth]'.padEnd(24)} ${err.message}`);
    }
  }

  await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
  return results;
}

function argToText(a) {
  if (a === null || a === undefined) return '';
  if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
  return a.description || a.unserializableValue || a.className || a.type || '';
}

function dedupeMessages(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item.kind + '|' + item.text.slice(0, 160);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 10) break;
  }
  return out;
}

async function evaluate(cdp, sessionId, expression, silent = false) {
  const res = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails && !silent) {
    throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'evaluate failed');
  }
  return res.result?.value;
}

async function callInPage(cdp, sessionId, fn, opts) {
  const expression = `(${fn.toString()})(${JSON.stringify(opts)})`;
  const value = await evaluate(cdp, sessionId, expression);
  return value || { findings: [] };
}

async function navigate(cdp, sessionId, url, state, cfg) {
  let loaded = false;
  const onLoad = () => { loaded = true; };
  cdp.on(sessionId, 'Page.loadEventFired', onLoad);
  const nav = await cdp.send('Page.navigate', { url }, sessionId);
  if (nav.errorText) throw new Error(nav.errorText);

  const deadline = Date.now() + cfg.timing.navigationTimeoutMs;
  while (!loaded && Date.now() < deadline) await sleep(100);
  if (!loaded) throw new Error(`load event not fired within ${cfg.timing.navigationTimeoutMs}ms`);

  // network-quiet: no in-flight request for 700ms (or 10s hard cap)
  const quietDeadline = Date.now() + 10000;
  while (Date.now() < quietDeadline) {
    if (state.inflight <= 0 && Date.now() - state.lastActivity > 700) break;
    await sleep(100);
  }
  await sleep(cfg.timing.settleMs);
}

// ---------------------------------------------------------------------------
// Severity / ignore handling + reporting
// ---------------------------------------------------------------------------

/**
 * The route the page actually rendered, when a guard bounced us somewhere else.
 * Null when we landed where we asked to — including on /login itself, which is
 * a legitimate destination when /login is what was requested.
 */
function authRedirect(requested, finalUrl) {
  if (!finalUrl) return null;
  // Whole path segments, not a prefix: `/loginish` is its own route, not the
  // login wall. (The selftest table pins that case.)
  const isLogin = (path) => path === '/login' || path.startsWith('/login/');
  const landedPath = String(finalUrl).split('?')[0];
  const askedPath = String(requested).split('?')[0];
  if (!isLogin(landedPath)) return null;
  if (askedPath === landedPath || isLogin(askedPath)) return null;
  return String(finalUrl);
}

function severityOf(finding, cfg) {
  return cfg.severity[finding.check] || 'error';
}

function isIgnored(finding, cfg) {
  if (severityOf(finding, cfg) === 'off') return true;
  const pats = (cfg.ignore.selectors && cfg.ignore.selectors[finding.check]) || [];
  for (const p of pats) {
    try { if (new RegExp(p).test(finding.selector || '')) return true; } catch { /* bad regex → ignore */ }
  }
  if (finding.check === 'console-error' || finding.check === 'network-error') {
    for (const p of cfg.ignore.consolePatterns || []) {
      try { if (new RegExp(p).test(finding.message || '')) return true; } catch { /* bad regex */ }
    }
  }
  return false;
}

const CHECK_HELP = {
  'horizontal-overflow': 'the page can be scrolled sideways — something is wider than the viewport',
  'tap-target-too-small': 'a control is smaller than the 44px minimum touch size (Apple HIG / WCAG 2.5.8)',
  'text-too-small': 'text renders below the readable minimum font size',
  'content-clipped': 'text is cut off by an overflow:hidden box without ellipsis/line-clamp',
  'overlapping-content': 'another element sits on top of a control — the tap does not reach it',
  'fixed-overlay-covers-control': 'a fixed/sticky bar covers an interactive element',
  'viewport-meta': 'the viewport meta tag is missing or blocks pinch-zoom',
  'console-error': 'the page logged an error or threw while rendering on this device',
  'network-error': 'a request failed or returned >= 400 on this device',
  'auth-redirect': 'a guard bounced this route to /login — the audit was skipped, nothing on the route was measured',
};

function report(results, cfg, ctx) {
  const bad = [];
  let errorCount = 0;
  let warnCount = 0;

  console.log('');
  console.log('─'.repeat(72));
  console.log('  MOBILE & TABLET GATE');
  console.log(`  target : ${ctx.baseUrl}  (${ctx.mode})`);
  console.log(`  devices: ${ctx.devices.map((d) => `${d.label} ${d.width}×${d.height} ${d.os}`).join(' · ')}`);
  console.log(`  routes : ${ctx.routes.join(' ')}`);
  if (ctx.unchecked && ctx.unchecked.routes.length) {
    console.log(`  UNCHECKED: ${ctx.unchecked.routes.join(' ')}`);
    console.log(`             ${ctx.unchecked.why}`);
  }
  console.log('─'.repeat(72));

  for (const r of results) {
    const errs = r.findings.filter((f) => severityOf(f, cfg) === 'error');
    const warns = r.findings.filter((f) => severityOf(f, cfg) === 'warn');
    errorCount += errs.length;
    warnCount += warns.length;
    if (!errs.length && !warns.length) continue;
    const dev = DEVICES[r.device];
    console.log('');
    // Against the requested PATH — `r.route` carries the " [panel]" label for
    // panel rows, so comparing to it flagged every one of them as redirected.
    const redirected = r.finalUrl && r.finalUrl !== (r.path || r.route) ? `  (redirected → ${r.finalUrl})` : '';
    console.log(`${errs.length ? 'FAIL' : 'warn'}  ${dev.label} ${dev.width}×${dev.height} ${dev.os}   ${r.route}${redirected}`);
    const shown = [...errs, ...warns];
    const limit = Number(args.opts['max-lines'] || 6);
    for (const f of shown.slice(0, limit)) {
      const sev = severityOf(f, cfg) === 'error' ? 'x' : '!';
      console.log(`   ${sev} ${f.check}: ${f.message}`);
      if (f.selector) console.log(`       at ${f.selector}${f.text ? `   ("${f.text}")` : ''}`);
      if (f.scrollY) console.log(`       visible at scrollY=${f.scrollY}px`);
    }
    if (shown.length > limit) {
      console.log(`   … +${shown.length - limit} more on this device/route (--max-lines=99 or --json=… for all)`);
    }
    if (r.screenshot) console.log(`       screenshot: ${r.screenshot}`);
    if (errs.length) bad.push(`${dev.label} ${r.route}`);
  }

  const byCheck = {};
  for (const r of results) {
    for (const f of r.findings) {
      const sev = severityOf(f, cfg);
      if (sev === 'off') continue;
      byCheck[f.check] = byCheck[f.check] || { error: 0, warn: 0 };
      byCheck[f.check][sev]++;
    }
  }

  console.log('');
  console.log('─'.repeat(72));
  console.log(`  ${results.length} page audits · ${errorCount} blocking findings · ${warnCount} warnings`);
  for (const [check, c] of Object.entries(byCheck).sort((a, b) => b[1].error - a[1].error)) {
    console.log(`    ${String(c.error).padStart(4)} err ${String(c.warn).padStart(3)} warn  ${check.padEnd(30)} ${CHECK_HELP[check] || ''}`);
  }
  console.log('─'.repeat(72));
  if (errorCount) {
    console.log(`  RESULT: RED — mobile gate failed on ${bad.length} device/route combination(s).`);
    console.log('  Fix the findings above, or (only with a justification + follow-up issue)');
    console.log('  add a narrow ignore entry in scripts/mobile-gate.config.json.');
    console.log('  Details: docs/mobile-gate.md');
  } else if (ctx.unchecked && ctx.unchecked.routes.length) {
    // A GREEN that silently covers a fraction of the app is the failure this
    // whole check exists to prevent — so the verdict says what it did NOT see.
    console.log(
      `  RESULT: GREEN for the ${ctx.routes.length} route(s) audited — ` +
        `${ctx.unchecked.routes.length} route(s) went UNCHECKED (see above).`,
    );
  } else {
    console.log('  RESULT: GREEN — phone + tablet layouts pass every check.');
  }
  console.log('─'.repeat(72));
  console.log('');
  return errorCount;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const SELFTEST_EXPECTED = [
  'viewport-meta',
  'horizontal-overflow',
  'tap-target-too-small',
  'text-too-small',
  'content-clipped',
  'overlapping-content',
  'fixed-overlay-covers-control',
  'console-error',
];

/**
 * `auth-redirect` is the one check with no fixture: the selftest serves a
 * static file, and a static file cannot bounce you to a login form. So prove
 * the decision itself instead — a silent regression here would put the whole
 * login-wall blind spot back, and nothing else in the suite would notice.
 */
const AUTH_REDIRECT_CASES = [
  { requested: '/codex/ship/CNOU_Nomad', finalUrl: '/login?redirect=%2Fcodex%2Fship', expect: true },
  { requested: '/news', finalUrl: '/login', expect: true },
  { requested: '/login', finalUrl: '/login', expect: false },
  { requested: '/login', finalUrl: '/login?redirect=%2Fnews', expect: false },
  { requested: '/about', finalUrl: '/about', expect: false },
  { requested: '/hangar', finalUrl: '/hangar?tab=fleet', expect: false },
  { requested: '/admin/feedback', finalUrl: '/loginish', expect: false },
  { requested: '/news', finalUrl: null, expect: false },
];

function selftestAuthRedirect() {
  const failed = [];
  for (const c of AUTH_REDIRECT_CASES) {
    const got = authRedirect(c.requested, c.finalUrl) !== null;
    if (got !== c.expect) {
      failed.push(`${c.requested} → ${c.finalUrl}: expected ${c.expect ? 'a finding' : 'no finding'}`);
    }
  }
  return failed;
}

function reportSelftest(results) {
  const fired = new Set();
  for (const r of results) for (const f of r.findings) fired.add(f.check);
  console.log('');
  console.log('─'.repeat(72));
  console.log('  MOBILE GATE SELF-TEST — every check must fire on the fixture page');
  console.log('─'.repeat(72));
  const missing = [];
  for (const check of SELFTEST_EXPECTED) {
    const ok = fired.has(check);
    if (!ok) missing.push(check);
    console.log(`   ${ok ? 'ok  ' : 'DEAD'} ${check}`);
  }
  const authCases = selftestAuthRedirect();
  if (authCases.length) {
    missing.push('auth-redirect');
    console.log(`   DEAD auth-redirect  (${authCases.length} case(s) wrong)`);
    for (const f of authCases) console.log(`        ${f}`);
  } else {
    console.log(`   ok   auth-redirect  (${AUTH_REDIRECT_CASES.length} cases, no fixture — decided in code)`);
  }
  console.log('─'.repeat(72));
  if (missing.length) {
    console.log(`  RESULT: BROKEN — ${missing.length} check(s) no longer detect their own fixture: ${missing.join(', ')}`);
    console.log('  The gate would pass a broken app. Fix scripts/mobile-gate.mjs before trusting a green run.');
  } else {
    console.log('  RESULT: GREEN — all checks detect their fixture violation.');
  }
  console.log('─'.repeat(72));
  console.log('');
  return missing.length;
}

/** Everything that must be shut down even when the run explodes mid-way. */
const teardown = [];
let torndown = false;
function runTeardown() {
  if (torndown) return;
  torndown = true;
  for (const fn of teardown.reverse()) {
    try { fn(); } catch { /* best effort */ }
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { runTeardown(); process.exit(130); });

async function main() {
  const cfg = loadConfig();
  const quick = args.flags.has('quick');
  const selftest = args.flags.has('selftest');
  if (selftest) {
    args.opts.devices = args.opts.devices || 'iphone-14';
    args.opts.routes = '/';
  }

  const deviceIds = (args.opts.devices ? args.opts.devices.split(',') : quick ? cfg.quickDevices : cfg.devices)
    .map((d) => d.trim())
    .filter(Boolean);
  for (const id of deviceIds) if (!DEVICES[id]) fail(`Unknown device "${id}". Known: ${Object.keys(DEVICES).join(', ')}`);
  const devices = deviceIds.map((id) => DEVICES[id]);

  const routes = (args.opts.routes ? args.opts.routes.split(',') : quick ? cfg.quickRoutes : cfg.routes)
    .map((r) => r.trim())
    .filter(Boolean)
    .filter((r) => !(cfg.ignore.routes || []).includes(r))
    .map((r) => (r.startsWith('/') ? r : '/' + r));

  // Opt-in authenticated pass (#516). Credentials live in the environment,
  // never in the repo — and a missing one is a hard stop, because an --auth
  // run that silently audits nothing is exactly the false GREEN this closes.
  const wantsAuth = args.flags.has('auth') || process.env.MOBILE_GATE_AUTH === '1';
  let auth = null;
  if (wantsAuth && !selftest) {
    const email = process.env.SC_GATE_EMAIL;
    const password = process.env.SC_GATE_PASSWORD;
    if (!email || !password) {
      fail(
        '--auth needs SC_GATE_EMAIL and SC_GATE_PASSWORD in the environment ' +
          '(a dedicated test account with the role you want audited). ' +
          'Refusing to run an authenticated pass that would audit nothing.',
      );
    }
    const a = cfg.auth || {};
    auth = {
      credentials: { email, password },
      routes: (a.routes || []).filter((r) => !(cfg.ignore.routes || []).includes(r)),
      panelRoutes: a.panelRoutes || [],
    };
    if (!auth.routes.length && !auth.panelRoutes.length) {
      fail('--auth: `auth.routes` and `auth.panelRoutes` are both empty in mobile-gate.config.json.');
    }
  }

  const screenshotDir = args.opts.screenshots ? resolve(REPO_ROOT, args.opts.screenshots) : null;
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });

  // Opt-in escape hatch for environments that simply have no Chromium (bare CI
  // containers). Loud on purpose: a skipped gate must never read as a pass.
  const maySkip = args.flags.has('skip-if-unavailable') || process.env.MOBILE_GATE_SKIP_IF_UNAVAILABLE === '1';
  if (maySkip && !findBrowser()) {
    console.log(
      '[mobile-gate] SKIPPED — no Chrome/Edge binary in this environment ' +
        '(--skip-if-unavailable). The mobile gate did NOT run; it is not a pass.',
    );
    process.exit(0);
  }

  const target = await resolveTarget(cfg);
  teardown.push(() => target.stop && target.stop());
  const browser = await launchBrowser({ headless: !args.flags.has('headful') });
  teardown.push(() => browser.close());
  const cdp = await Cdp.connect(browser.wsUrl);
  teardown.push(() => cdp.close());

  const authSuffix = auth
    ? ` · +auth (${auth.routes.length} route(s) on every device, ${auth.panelRoutes.length} panel(s) on phones)`
    : '';
  console.log(
    `[mobile-gate] ${target.baseUrl} (${target.mode}) · ${devices.length} devices × ${routes.length} public route(s)${authSuffix}`,
  );

  const concurrency = Math.max(1, Number(args.opts.concurrency || Math.min(devices.length, 2)));
  const queue = [...devices];
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const device = queue.shift();
      if (!device) return;
      const res = await runDevice(cdp, device, routes, target.baseUrl, cfg, screenshotDir, auth);
      results.push(...res);
    }
  });
  try {
    await Promise.all(workers);
  } finally {
    console.log('');
    runTeardown();
  }

  const reportRoutes = [
    ...routes,
    ...(auth ? [...auth.routes, ...auth.panelRoutes.map((r) => `${r} [panel]`), '[auth]'] : []),
  ];
  results.sort(
    (a, b) =>
      deviceIds.indexOf(a.device) - deviceIds.indexOf(b.device) ||
      reportRoutes.indexOf(a.route) - reportRoutes.indexOf(b.route),
  );
  // Routes that exist in the config but no pass could reach this run. Without
  // credentials the signed-in pass never happens, and every route behind the
  // login wall is simply absent from the verdict — which must be said out loud.
  // Deduped: a panel route is usually also a signed-in route, and listing it
  // twice would overstate how much went unchecked.
  const configuredAuthRoutes = [
    ...new Set([...((cfg.auth || {}).routes || []), ...((cfg.auth || {}).panelRoutes || [])]),
  ];
  const unchecked = !auth && configuredAuthRoutes.length
    ? {
        routes: configuredAuthRoutes,
        why: wantsAuth
          ? 'the authenticated pass could not run'
          : 'these need a signed-in session: re-run with --auth and SC_GATE_EMAIL / SC_GATE_PASSWORD set',
      }
    : null;

  const errorCount = selftest
    ? reportSelftest(results)
    : report(results, cfg, { baseUrl: target.baseUrl, mode: target.mode, devices, routes: reportRoutes, unchecked });

  if (args.opts.json) {
    const out = resolve(REPO_ROOT, args.opts.json);
    writeFileSync(out, JSON.stringify({ baseUrl: target.baseUrl, generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`[mobile-gate] JSON report → ${out}`);
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  runTeardown();
  console.error(`\n[mobile-gate] crashed: ${err.stack || err.message}\n`);
  process.exit(2);
});
