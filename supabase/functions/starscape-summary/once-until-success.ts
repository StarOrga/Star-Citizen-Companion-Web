// Pure helper, no Deno or network imports, so Node's test runner can load it
// (npm run test:assets-worker). Used for the resvg-wasm init in index.ts.

/** Memoizes an async init, but forgets a failure so the next call retries. */
export function onceUntilSuccess<T>(init: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = init().catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };
}
