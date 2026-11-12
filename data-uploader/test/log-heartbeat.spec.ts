import { describe, it, expect } from 'vitest';
import { createHeartbeat } from '../src/lib/log-budget.js';

describe('createHeartbeat', () => {
  it('logs the latest progress once per interval and ignores other events', () => {
    let t = 0;
    const beat = createHeartbeat('skin', 180_000, () => t);
    t = 60_000;
    expect(beat({ type: 'progress', stage: 'ships', current: 3, total: 90 })).toBeNull();
    t = 181_000;
    expect(beat({ type: 'log' })).toBeNull();
    expect(beat({ type: 'progress', stage: 'ships', current: 12, total: 90 })).toBe('[skin] still running: ships 12/90');
    t = 200_000;
    expect(beat({ type: 'progress', stage: 'ships', current: 13, total: 90 })).toBeNull();
    t = 362_000;
    expect(beat({ type: 'phase', phase: 'bundle' })).toBe('[skin] still running: bundle');
  });
});
