/** First paint is seldom later than this; past it the planet must not keep waiting for it. */
const FCP_CAP_MS = 6000;

/** A hidden tab has no animation frames; WebGL work must not wait for it to come back. */
const HIDDEN_TAB_MS = 200;

/**
 * Runs `fn` once the page's first content is really on screen. A first WebGL
 * context and its shaders keep the GPU process busy, and on software rendering
 * they hold up that first frame even from a worker: the frame has left the main
 * thread long before it is presented. With a GPU the two lie a frame apart, so
 * this costs nothing there. After that first paint it only waits for the next
 * frame. Returns the cancel function.
 */
export function afterFirstContentfulPaint(fn: () => void): () => void {
  const painted = () => performance.getEntriesByName?.('first-contentful-paint').length > 0;
  if (typeof PerformanceObserver !== 'function' || document.hidden || painted()) return afterNextPaint(fn);
  let cancelNext: (() => void) | null = null;
  const go = () => {
    observer.disconnect();
    clearTimeout(timer);
    cancelNext = afterNextPaint(fn);
  };
  const observer = new PerformanceObserver(() => {
    if (painted()) go();
  });
  observer.observe({ type: 'paint', buffered: true });
  const timer = setTimeout(go, FCP_CAP_MS);
  return () => {
    observer.disconnect();
    clearTimeout(timer);
    cancelNext?.();
  };
}

/** Runs `fn` right after the next frame went out. Returns the cancel function. */
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
