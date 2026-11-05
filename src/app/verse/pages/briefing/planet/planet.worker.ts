import { PlanetWorkerScope, runPlanetWorker } from './planet-worker-core';

runPlanetWorker(self as unknown as PlanetWorkerScope);
