import { effectivePlayability, VerseStatus, StatusLevel } from './news.service';

function status(overall: StatusLevel, components: [string, StatusLevel][]): VerseStatus {
  return {
    overall,
    label: overall,
    components: components.map(([name, s]) => ({ name, status: s })),
    updatedAt: '2026-07-21T00:00:00.000Z',
  };
}

describe('effectivePlayability', () => {
  it('escalates the headline when Persistent Universe is under maintenance but overall reads operational', () => {
    // RSI Statuspage keeps the overall "operational" during a scheduled PU
    // maintenance — the exact case from feedback 740d31cb.
    const st = status('operational', [
      ['Persistent Universe', 'maintenance'],
      ['Platform', 'operational'],
    ]);
    expect(effectivePlayability(st)).toBe('maintenance');
  });

  it('escalates to a PU outage over an operational overall', () => {
    const st = status('operational', [['Persistent Universe', 'major_outage']]);
    expect(effectivePlayability(st)).toBe('major_outage');
  });

  it('stays operational when Persistent Universe is operational', () => {
    const st = status('operational', [
      ['Persistent Universe', 'operational'],
      ['RSI Website', 'maintenance'],
    ]);
    // A website-only maintenance must NOT flip the game-playability headline.
    expect(effectivePlayability(st)).toBe('operational');
  });

  it('keeps a worse overall when it exceeds the PU component level', () => {
    const st = status('major_outage', [['Persistent Universe', 'operational']]);
    expect(effectivePlayability(st)).toBe('major_outage');
  });

  it('falls back to the overall when there is no Persistent Universe component', () => {
    const st = status('degraded', [['Platform', 'operational']]);
    expect(effectivePlayability(st)).toBe('degraded');
  });

  it('matches the Persistent Universe component case-insensitively', () => {
    const st = status('operational', [['PERSISTENT UNIVERSE', 'degraded']]);
    expect(effectivePlayability(st)).toBe('degraded');
  });
});
