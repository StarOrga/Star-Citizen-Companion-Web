/**
 * Type surface of `idle-io-probe.js` for the vitest suite
 * (`test/idle-io.spec.ts`). The script stays plain JS so it runs under bare
 * `node` against a packaged build; keep this in sync.
 */
export interface CounterSample {
  writes: number;
  writeBytes: number;
  type?: string;
}

export interface IdleBudget {
  maxWritesPer30s: number;
  maxBytesPerSec: number;
  maxLogGrowthBytes: number;
}

export const IDLE_BUDGET: Readonly<IdleBudget>;

export interface IdleBudgetResult {
  ok: boolean;
  writes: number;
  writeBytes: number;
  writesPer30s: number;
  bytesPerSec: number;
  logGrowthBytes: number;
  breaches: string[];
}

export function evaluateIdleBudget(
  input: {
    before: Record<string, CounterSample>;
    after: Record<string, CounterSample>;
    seconds: number;
    logGrowthBytes: number;
  },
  budget?: IdleBudget,
): IdleBudgetResult;
