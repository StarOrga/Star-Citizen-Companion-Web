/// <reference types="vite/client" />
// Brings the preload's `declare global { interface Window { sc: typeof api } }`
// into the renderer program, so `window.sc` is typed from the one API object the
// preload exposes — no second, hand-written copy of its shape.
import type {} from '../preload/index.js';
