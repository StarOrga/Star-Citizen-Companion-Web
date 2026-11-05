import { BodyWorkerScope, runBodyWorker } from './body-worker-core';

runBodyWorker(self as unknown as BodyWorkerScope);
