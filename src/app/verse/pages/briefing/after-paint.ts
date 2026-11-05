/** A hidden tab has no animation frames; WebGL work must not wait for it to come back. */
const HIDDEN_TAB_MS = 200;

/**
 * Runs `fn` right after the next frame went out. A first WebGL context and its
 * shaders keep the GPU process busy, and on software rendering they hold up the
 * page's first paint even from a worker (lab: FCP 3.1 s to 6.4 s). So they start
 * only once the page stands. Returns the cancel function.
 */
export function afterNextPaint(fn: () => void): () => void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    fn();
  };
  // rAF runs before that frame is painted; a task queued from it runs after.
  const frame = requestAnimationFrame(() => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      run();
    };
    port2.postMessage(0);
  });
  const timer = setTimeout(run, HIDDEN_TAB_MS);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
