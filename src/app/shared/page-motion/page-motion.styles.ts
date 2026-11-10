/**
 * Shared page motion of the camera world (concept kamera-welt, rounds/05 `d5-pb-minor`, `d5-pb-detail`, `d5-pb-scroll`):
 * the light edge, the title scan and the staggered rise every playbook page uses. A component adds this string to
 * its `styles` array (Angular scopes the class names and the keyframe names per component, so nothing leaks).
 *
 * Vocabulary
 *  - `.pm-rise`   a card/block rises with a light edge (brightness flash that decays). `--pm-i` = its place in the order.
 *  - `.pm-pop`    a list row pops in (shorter, tighter). `--pm-i` = its row, one every {@link PM_ROW_STEP_MS}.
 *  - `.pm-glide`  a rail icon glides in from the screen edge, one by one.
 *  - `.pm-scan`   a headline opens with a light edge travelling across it, then an afterglow.
 *
 * Everything is `transform`/`opacity`/`filter`/`clip-path` only. The classes do nothing until the page root carries
 * `.pm-on` (the shell beta decides); under `prefers-reduced-motion` they shrink to a plain 200 ms fade.
 * The delays are tokens so a page can tune its own order: `--pm-delay` (start), `--pm-step` (between siblings).
 */
export const PM_ROW_STEP_MS = 70;

export const PAGE_MOTION_STYLES = `
  .pm-on {
    --pm-ease: cubic-bezier(0.16, 0.84, 0.24, 1);
    --pm-delay: 0ms;
    --pm-step: 120ms;
  }
  .pm-on .pm-rise {
    animation: pm-rise 560ms var(--pm-ease) calc(var(--pm-delay) + var(--pm-i, 0) * var(--pm-step)) backwards;
  }
  .pm-on .pm-pop {
    animation: pm-pop 420ms var(--pm-ease) calc(var(--pm-delay) + var(--pm-i, 0) * ${PM_ROW_STEP_MS}ms) backwards;
  }
  .pm-on .pm-glide {
    animation: pm-glide 340ms var(--pm-ease) calc(var(--pm-delay) + var(--pm-i, 0) * 60ms) backwards;
  }
  .pm-on .pm-scan {
    animation: pm-scan 720ms var(--pm-ease) var(--pm-delay) backwards;
  }
  .pm-on .pm-scan-line {
    animation: pm-scan-line 900ms var(--pm-ease) var(--pm-delay) both;
  }
  .pm-on .pm-fade {
    animation: pm-fade 420ms ease-out var(--pm-delay) backwards;
  }
  @keyframes pm-rise {
    0% { opacity: 0; transform: translateY(14px) scale(0.985); filter: brightness(2.2); }
    55% { opacity: 1; filter: brightness(1.55); }
    100% { opacity: 1; transform: none; filter: none; }
  }
  @keyframes pm-pop {
    0% { opacity: 0; transform: translateY(6px) scale(0.985); filter: brightness(2.4); }
    42% { opacity: 1; transform: none; filter: brightness(1.7); }
    100% { opacity: 1; transform: none; filter: none; }
  }
  @keyframes pm-glide {
    0% { opacity: 0; transform: translateX(-26px); }
    100% { opacity: 1; transform: none; }
  }
  @keyframes pm-scan {
    0% { clip-path: inset(0 100% 0 0); opacity: 1; filter: brightness(2.2) drop-shadow(0 0 0 var(--sc-accent)); }
    55% { clip-path: inset(0 0 0 0); filter: brightness(1.6) drop-shadow(0 0 14px var(--sc-accent)); }
    100% { clip-path: inset(0 0 0 0); filter: none; }
  }
  @keyframes pm-scan-line {
    0% { transform: scaleX(0); opacity: 0; }
    12% { opacity: 1; }
    58% { transform: scaleX(1); opacity: 1; }
    100% { transform: scaleX(1); opacity: 0; }
  }
  @keyframes pm-fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .pm-on .pm-rise, .pm-on .pm-pop, .pm-on .pm-glide, .pm-on .pm-scan, .pm-on .pm-fade {
      animation: pm-fade 200ms ease-out backwards;
      animation-delay: 0ms;
    }
    .pm-on .pm-scan-line { animation: none; opacity: 0; }
  }
`;
