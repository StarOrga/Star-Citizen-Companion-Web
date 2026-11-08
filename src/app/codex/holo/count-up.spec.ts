import { COUNT_UP_MS, CountUp } from './count-up';

describe('CountUp (cx-countup)', () => {
  let now = 0;
  const clock = () => now;

  beforeEach(() => (now = 1000));

  it('a number that appears counts up from zero and lands on its value', () => {
    const c = new CountUp(false, COUNT_UP_MS, clock);
    expect(c.value('ir', 12000)).toBe(0);
    now += COUNT_UP_MS / 2;
    const mid = c.value('ir', 12000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(12000);
    now += COUNT_UP_MS;
    expect(c.value('ir', 12000)).toBe(12000);
    expect(c.idle).toBe(true);
    c.dispose();
  });

  it('a changed number rolls from where it stood, not from zero', () => {
    const c = new CountUp(false, COUNT_UP_MS, clock);
    c.value('pct', 40);
    now += COUNT_UP_MS * 2;
    expect(c.value('pct', 40)).toBe(40);
    expect(c.value('pct', 80)).toBe(40);
    now += COUNT_UP_MS / 2;
    const mid = c.value('pct', 80);
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(80);
    c.dispose();
  });

  it('keys run independently', () => {
    const c = new CountUp(false, COUNT_UP_MS, clock);
    c.value('a', 10);
    now += COUNT_UP_MS * 2;
    expect(c.value('a', 10)).toBe(10);
    expect(c.value('b', 10)).toBe(0);
    c.dispose();
  });

  it('reduced motion: every value stands at once', () => {
    const c = new CountUp(true, COUNT_UP_MS, clock);
    expect(c.value('ir', 12000)).toBe(12000);
    expect(c.value('ir', 9000)).toBe(9000);
    c.dispose();
  });
});
