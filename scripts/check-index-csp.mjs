/**
 * Guard: the BUILT index.html must contain no inline event handler.
 *
 * Why this exists. Our `script-src` grants neither 'unsafe-inline' nor
 * 'unsafe-hashes', so the browser refuses to run any `on*=""` attribute in the
 * served HTML. Nothing in the toolchain notices: the build stays green, every
 * test stays green, and the only symptom is a console error on every route
 * plus whatever the blocked handler was supposed to do never happening.
 *
 * That is exactly how it shipped. Angular's critical-CSS inlining
 * (`optimization.styles.inlineCritical`, on by default in production) rewrites
 * the global stylesheet link into the async-preload pattern
 *
 *     <link rel="stylesheet" href="styles-*.css" media="print"
 *           onload="this.media='all'">
 *
 * The `onload` was blocked by CSP, so `media` never flipped from `print` to
 * `all` and the whole global stylesheet stayed inert on screen — including
 * `@angular/cdk/overlay-prebuilt.css` (src/styles.scss), which is what
 * positions every CDK overlay in quick-search, news-list and the feedback
 * attachments viewer. Headings silently fell back from Orbitron to Inter.
 *
 * The fix was to turn `inlineCritical` off in angular.json rather than to open
 * up `script-src`. That was not a close call here: beasties had nothing real to
 * extract, because the only above-the-fold markup in index.html is the static
 * boot splash. Its 19 kB of "critical" CSS was 49 duplicated `@font-face`
 * rules plus the `:root` design tokens — 19 kB added to every HTML response to
 * defer a 26 kB same-origin stylesheet on a page that already inlines its own
 * splash. Allowing the handler via 'unsafe-hashes' + a sha256 would have
 * preserved that trade AND pinned a hash to a string beasties can change in any
 * patch release, silently, with the build green. (A nonce cannot help at all:
 * per CSP, nonces do not apply to event handlers.)
 *
 * Runs as `postbuild`, so it inspects the real artifact Vercel serves — not the
 * source template, which never had the handler in it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const index = join(root, 'dist', 'sc-companion', 'browser', 'index.html');

if (!existsSync(index)) {
  console.error(`✗ ${index} does not exist — cannot verify the built HTML against the CSP.`);
  process.exit(1);
}

const html = readFileSync(index, 'utf8');

// Scan attributes inside tags only. Text between tags (the ld+json block, the
// inlined <style> blocks) is not markup and must not produce false positives.
const offenders = [];
for (const tag of html.match(/<[a-zA-Z][^>]*>/g) ?? []) {
  for (const [, attr] of tag.matchAll(/\s(on[a-z]+)\s*=/gi)) {
    offenders.push({ attr, tag: tag.length > 160 ? `${tag.slice(0, 160)}…` : tag });
  }
}

if (offenders.length > 0) {
  console.error('✗ The built index.html contains inline event handlers, which our CSP blocks.\n');
  for (const { attr, tag } of offenders) {
    console.error(`  ${attr} in: ${tag}\n`);
  }
  console.error("  script-src grants neither 'unsafe-inline' nor 'unsafe-hashes', so these");
  console.error('  handlers never run in production and fail silently apart from a console');
  console.error('  error. See scripts/check-index-csp.mjs for the full rationale — do not');
  console.error('  fix this by loosening the policy without reading it first.');
  process.exit(1);
}

console.log('✓ Built index.html has no inline event handlers (CSP-safe).');
