/** Styles the community-seed tabs of /admin/translations share (tokens only). */
export const TRANSLATIONS_TAB_STYLES = `
  :host { display: block; }
  .block { display: grid; gap: var(--sc-space-4); margin-bottom: var(--sc-space-4); }
  .block-head { display: flex; justify-content: space-between; align-items: center; gap: var(--sc-space-3); flex-wrap: wrap; }
  h2, h3 { margin: 0; font-size: 1.05rem; }
  h3 { font-size: 0.95rem; }
  .hint { margin: 0; color: var(--sc-fg-2); font-size: 0.88rem; }
  .state { display: grid; gap: var(--sc-space-3); justify-items: start; }
  .state.error { border-color: var(--sc-danger); }
  .flash { margin: 0 0 var(--sc-space-3); color: var(--sc-accent); }
  .flash.err { color: var(--sc-danger); }
  .field { display: grid; gap: var(--sc-space-2); font-size: 0.85rem; color: var(--sc-fg-1); min-width: 150px; }
  .field.grow { flex: 1 1 220px; }
  .row { display: flex; gap: var(--sc-space-3); align-items: center; flex-wrap: wrap; }
  .tip-wrap { display: contents; }
  .pill { padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
  .pill.ok { border-color: var(--sc-accent); color: var(--sc-accent); }
  .pill.warn { border-color: var(--sc-warning); color: var(--sc-warning); }
  .pill.bad { border-color: var(--sc-danger); color: var(--sc-danger); }
  .grow { flex: 1 1 auto; }
  .mono { font-family: var(--sc-font-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .bar { height: 8px; border-radius: 4px; background: var(--sc-bg-0); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--sc-accent); }
  textarea.sc-input { min-height: 7rem; resize: vertical; font: inherit; }
  .summary { display: grid; grid-template-columns: max-content 1fr; gap: var(--sc-space-1) var(--sc-space-4); margin: 0; font-size: 0.86rem; }
  .summary dt { color: var(--sc-fg-2); }
  .summary dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
`;
