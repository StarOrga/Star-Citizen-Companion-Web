import log from 'electron-log';
import { createHeartbeat, createLogBudget, type HeartbeatEvent } from '../lib/log-budget.js';

const HEARTBEAT_MS = 3 * 60_000;

interface SidecarEvent extends HeartbeatEvent {
  level?: string;
  message?: string;
}

/**
 * main.log trail for one sidecar job: warn/error lines always, info lines up to
 * a cap, plus a progress heartbeat every few minutes. Without it a long job left
 * only governor lines in the log and could not be told apart from a stalled one.
 */
export function createSidecarLogger(label: string, infoCap = 300): (ev: SidecarEvent) => void {
  const budget = createLogBudget(infoCap);
  const beat = createHeartbeat(label, HEARTBEAT_MS);
  return (ev) => {
    if (ev.type === 'log' && ev.message) {
      if (budget.take(ev.level)) {
        const text = `[${label}-py] ${ev.message}`;
        if (ev.level === 'error') log.error(text);
        else if (ev.level === 'warn') log.warn(text);
        else log.info(text);
      } else if (budget.dropped === 1) {
        log.info(`[${label}-py] further info lines are not written to this log (cap reached)`);
      }
      return;
    }
    const line = beat(ev);
    if (line) log.info(line);
  };
}
