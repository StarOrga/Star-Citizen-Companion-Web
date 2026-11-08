import type { EventRow, OpenEvent } from '../../../hq/events/event-logic';
import { hqLine } from './briefing-hq-line';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86_400_000;

function open(name: string, at: string | null): OpenEvent {
  const event = { id: name, name } as unknown as EventRow;
  return { event, end: { at, basis: at ? 'official' : 'unknown' }, state: 'open' };
}

describe('hqLine (HQ station value line)', () => {
  it('names a running event first, with the days left', () => {
    const l = hqLine([open('IAE 2956', new Date(NOW + 4.5 * DAY).toISOString())], 3, NOW);
    expect(l).toEqual({ key: 'verse.hub.hqEvent', params: { name: 'IAE 2956', n: 5 } });
  });

  it('prefers the event with a known end and handles one day / today / unknown', () => {
    expect(hqLine([open('A', null), open('B', new Date(NOW + 0.5 * DAY).toISOString())], 0, NOW).params['name']).toBe('B');
    expect(hqLine([open('B', new Date(NOW + 0.5 * DAY).toISOString())], 0, NOW).key).toBe('verse.hub.hqEventOne');
    expect(hqLine([open('B', new Date(NOW - 1000).toISOString())], 0, NOW).key).toBe('verse.hub.hqEventToday');
    expect(hqLine([open('A', null)], 0, NOW).key).toBe('verse.hub.hqEventOpen');
  });

  it('falls back to the open Nachschübe, then the all-clear', () => {
    expect(hqLine([], 1, NOW).key).toBe('verse.hub.hqSuppliesOne');
    expect(hqLine([], 4, NOW)).toEqual({ key: 'verse.hub.hqSupplies', params: { n: 4 } });
    expect(hqLine([], 0, NOW).key).toBe('verse.hub.hqCalm');
  });
});
