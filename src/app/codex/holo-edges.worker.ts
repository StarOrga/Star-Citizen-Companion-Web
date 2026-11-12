/// <reference lib="webworker" />
import { HoloEdgeJob, creaseEdgeArray } from './holo-edges';

/** One request: `{ id, job }` in, `{ id, edges }` out (the edge buffer transferred). */
addEventListener('message', (e: MessageEvent<{ id: number; job: HoloEdgeJob }>) => {
  const { id, job } = e.data;
  try {
    const edges = creaseEdgeArray(job);
    postMessage({ id, edges }, [edges.buffer]);
  } catch {
    postMessage({ id, edges: null });
  }
});
