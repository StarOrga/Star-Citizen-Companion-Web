import { EmModelItem, emModel, minimumSegments, scaledSignature } from './codex-em-model';

// Small fixtures shaped like the LIVE 4.10.2 extract (Gladius-like, #967).
const radar: EmModelItem = { role: 'consumer', segments: 5, minFraction: 0.4000000059604645, generateSegments: 0, em: 1800, ir: 0 };
const cooler: EmModelItem = { role: 'cooler', segments: 3, minFraction: 0.3, generateSegments: 0, em: 1490, ir: 7260 };
const shield: EmModelItem = { role: 'shield', segments: 3, minFraction: 0.3, generateSegments: 0, em: 1240, ir: 0 };
const quantum: EmModelItem = { role: 'quantum', segments: 2.25, minFraction: 1, generateSegments: 0, em: 18800, ir: 0 };
const thruster: EmModelItem = { role: 'thruster', segments: 0, minFraction: 0, generateSegments: 0, em: 1200, ir: 0 };
const plant: EmModelItem = { role: 'powerPlant', segments: 0, minFraction: 0, generateSegments: 20, em: 9900, ir: 0 };

describe('codex EM model (#967)', () => {
  it('reads the minimum as ⌈S × minFraction⌉ without float noise', () => {
    expect(minimumSegments(5, 0.4000000059604645)).toBe(2);
    expect(minimumSegments(3, 0)).toBe(0);
    expect(minimumSegments(2.25, 1)).toBe(2.25);
  });

  it('scales a component linearly from its nominal at full allocation (Ecouter 720–1,800)', () => {
    expect(scaledSignature(1800, 5, 2)).toBe(720);
    expect(scaledSignature(1800, 5, 5)).toBe(1800);
    expect(scaledSignature(18800, 2.25, 2.25, 1)).toBe(18800);
    expect(scaledSignature(18800, 2.25, 0, 1)).toBe(0);
  });

  it('idle: consumers at their minimum, shield and quantum off, reactor at that load', () => {
    const r = emModel([radar, cooler, shield, quantum, plant], 'idle');
    // radar 2 seg = 720, cooler 1 seg = 496.67, reactor 3 of 20 seg = 1485
    expect(r.load).toBe(3);
    expect(r.em).toBe(Math.round(720 + 1490 / 3 + 9900 * (3 / 20)));
    expect(r.ir).toBe(Math.round(7260 / 3));
  });

  it('max: everything full with the shield on; quantum: shield off, drive on', () => {
    const items = [radar, cooler, shield, quantum, plant];
    const max = emModel(items, 'max');
    expect(max.load).toBe(11);
    expect(max.em).toBe(Math.round(1800 + 1490 + 1240 + 9900 * (11 / 20)));
    const qt = emModel(items, 'quantum');
    expect(qt.load).toBe(10.25);
    expect(qt.em).toBe(Math.round(1800 + 1490 + 18800 + 9900 * (10.25 / 20)));
  });

  it('caps the reactor at its capacity and leaves thrusters out', () => {
    const small = { ...plant, generateSegments: 4, em: 1980 };
    const r = emModel([radar, cooler, thruster, small], 'max');
    expect(r.em).toBe(1800 + 1490 + 1980);
  });

  it('applies the hull armor factor to EM and IR', () => {
    const r = emModel([cooler], 'max', { em: 1.13, ir: 0.5 });
    expect(r.em).toBe(Math.round(1490 * 1.13));
    expect(r.ir).toBe(3630);
  });
});
