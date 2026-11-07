/**
 * Shared look of the HQ dialogs (Nachschub flow, delete / empty, archive): a scrim, a sheet with a header, a body
 * and a footer, all in app tokens. The host component puts `scDialog` on the sheet (focus in, Tab trap, Escape).
 */
export const HQ_DIALOG_STYLES = `
  .scrim { position: fixed; inset: 0; z-index: 150; display: grid; place-items: center; padding: var(--sc-space-4, 16px);
    background: color-mix(in srgb, var(--sc-bg-0) 66%, transparent); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
  .sheet { display: flex; flex-direction: column; min-height: 0; width: min(100%, var(--dlg-w, 560px)); max-height: min(100%, var(--dlg-h, 640px));
    border: 1px solid var(--sc-border); border-radius: 16px; background: var(--sc-bg-1); box-shadow: 0 24px 80px rgb(0 0 0 / 0.55); overflow: hidden;
    animation: dlg-in 0.22s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .dlg-head { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border-bottom: 1px solid var(--sc-border); flex: none; }
  .dlg-ic { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-accent); flex: none; }
  .dlg-ic svg { width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .dlg-title { margin: 0; flex: 1; min-width: 0; font: 600 1.05rem / 1.25 var(--sc-font-display, inherit); overflow-wrap: anywhere; }
  .dlg-title small { display: block; font: 400 0.78rem var(--sc-font-body, inherit); color: var(--sc-fg-2); }
  .dlg-body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--sc-space-4, 16px); display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
  .dlg-foot { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border-top: 1px solid var(--sc-border); flex: none; }
  .dlg-foot .sp { flex: 1; }
  .dlg-msg { margin: 0; color: var(--sc-fg-1); }
  .dlg-err { margin: 0; color: var(--sc-warning); }
  .opt { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); }
  @keyframes dlg-in { from { opacity: 0; transform: translateY(8px) scale(0.985); } }
  @media (prefers-reduced-motion: reduce) { .sheet { animation: none; } }
  @media (max-width: 640px) { .scrim { padding: 0; align-items: end; } .sheet { width: 100%; max-height: 100dvh; border-radius: 16px 16px 0 0; } }
`;
