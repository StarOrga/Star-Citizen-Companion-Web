/**
 * Shared look of the two dome-rim challenges (comet + constellation guess):
 * header (kind · task · ⓘ · state), one-click token rail with the rim line
 * running UNDER the tokens, footer. One interaction model for both.
 */
export const TRACK_STYLES = `
  :host { display: block; min-width: 0; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .head b { font-size: 0.875rem; font-weight: 600; color: var(--sc-fg-0); }
  .kind { display: inline-flex; align-items: center; gap: 6px; font: 0.8rem var(--sc-font-display); letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--sc-fg-2); white-space: nowrap; }
  .info { width: 24px; height: 24px; border-radius: 50%; border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent);
    display: inline-grid; place-items: center; flex: none; padding: 0; background: none; font: italic 600 0.7rem/1 Georgia, serif;
    color: var(--sc-fg-1); cursor: help; }
  .info:hover, .info:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); outline: none; }
  .state { display: inline-flex; align-items: center; gap: 7px; font-size: 0.8rem; color: var(--sc-fg-1); white-space: nowrap; }
  .state { margin-left: auto; }
  .ring { width: 14px; height: 14px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--sc-accent) 80%, #fff); }
  .ring.half { background: linear-gradient(90deg, var(--sc-warning) 50%, transparent 50%); box-shadow: inset 0 0 0 1.5px var(--sc-warning); }
  .ring.done { background: var(--sc-success); box-shadow: none; display: grid; place-items: center; }
  .ring.done::after { content: '✓'; font: 700 10px/1 var(--sc-font-body, inherit); color: var(--sc-bg-0); }
  .ring.closed { background: color-mix(in srgb, var(--sc-fg-2) 55%, transparent); box-shadow: none; }
  .state.tip { color: color-mix(in srgb, var(--sc-warning) 60%, #fff); }
  .rail { align-self: start; position: relative; display: flex; gap: 6px; align-items: flex-end; padding-bottom: var(--rim, 0px); }
  .tok { position: relative; flex: 1 1 0; min-width: 0; height: 44px; display: grid; align-content: center; justify-items: center; gap: 2px;
    padding: 0; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, transparent);
    background: color-mix(in srgb, var(--sc-bg-1) 60%, transparent); color: var(--sc-fg-1);
    font: 500 0.875rem/1 inherit; font-variant-numeric: tabular-nums; cursor: pointer;
    translate: 0 calc(var(--i) * var(--i) * var(--k, 0px)); transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease; }
  .tok small { font-size: 0.8rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-fg-2); }
  .tok:not(:disabled):hover, .tok:focus-visible { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-0); }
  .tok:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .tok:disabled { cursor: default; }
  .tok.dim { opacity: 0.45; }
  .curve { position: absolute; left: 0; right: 0; top: calc(100% - var(--rim, 0px) + 8px); width: 100%; overflow: visible; pointer-events: none; }
  .curve path { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 40%, transparent); stroke-width: 1; }
  .foot { display: grid; gap: 6px; margin-top: 18px; font-size: 0.8rem; color: var(--sc-fg-1); line-height: 1.35; }
  .foot > span { display: flex; align-items: center; gap: 8px; }
  .foot b { color: var(--sc-fg-0); font-weight: 600; }
  .muted { color: var(--sc-fg-2); }
  .err { color: var(--sc-danger); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .retry { min-height: 32px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--sc-accent); background: none; color: var(--sc-fg-0); font: inherit; cursor: pointer; }
  .retry:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  @media (pointer: coarse) { .tok { min-height: 48px; } }
  @media (max-width: 760px) {
    .tok { translate: none; }
    .curve { display: none; }
    .rail { padding-bottom: 0; overflow-x: auto; }
    .tok { flex: 0 0 44px; }
  }
  @media (prefers-reduced-motion: reduce) { .tok { transition: none; } }
`;

/** Comet glyph (head + tail); state class s-none / s-tipped / s-hit / s-miss. */
export const COMET_STYLES = `
  .comet { position: relative; display: inline-block; flex: none; width: 30px; height: 10px; vertical-align: middle; transform: rotate(20deg);
    opacity: 0.32; filter: grayscale(1); }
  .comet::before { content: ''; position: absolute; left: 0; right: 4px; top: 3px; height: 4px; clip-path: polygon(0 50%, 100% 0, 100% 100%);
    transform-origin: right center; background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--sc-accent) 40%, transparent) 45%, #eaf9ff); }
  .comet::after { content: ''; position: absolute; right: 0; top: 1px; width: 8px; height: 8px; border-radius: 50%;
    background: radial-gradient(circle, #fff 0 25%, color-mix(in srgb, var(--sc-accent) 70%, #fff) 40%, transparent 72%);
    box-shadow: 0 0 8px color-mix(in srgb, var(--sc-accent) 70%, #fff); }
  .comet.s-tipped, .comet.s-hit { opacity: 1; filter: none; }
  .comet.s-hit::before { left: -12px; animation: tr-tail 2.8s ease-in-out infinite; }
  .comet.fall { position: absolute; z-index: 3; width: 52px; height: 12px; right: 50%; bottom: 100%; margin: 0 -6px 0 0; transform: rotate(32deg);
    transform-origin: 100% 50%; pointer-events: none; }
  @keyframes tr-tail { 0%, 100% { transform: scaleX(0.82); } 50% { transform: scaleX(1.12); } }
  .sun { position: relative; display: inline-block; flex: none; width: 12px; height: 12px; }
  .sun > i { position: absolute; inset: 3px; border-radius: 50%; background: radial-gradient(circle, #fff3dc 0 35%, var(--sc-warning) 100%);
    box-shadow: 0 0 6px 1px color-mix(in srgb, var(--sc-warning) 55%, transparent); }
  @media (prefers-reduced-motion: reduce) { .comet.s-hit::before { animation: none; } }
`;
