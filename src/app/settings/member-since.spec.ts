import { memberSince } from './member-since';

describe('memberSince', () => {
  const now = new Date('2026-09-01T12:00:00Z');

  it('reports "today" for an account created moments ago', () => {
    expect(memberSince(new Date('2026-09-01T09:00:00Z'), now)).toEqual({
      unit: 'today',
      count: 0,
    });
  });

  it('reports "today" for a clock-skewed future date instead of a negative span', () => {
    expect(memberSince(new Date('2027-01-01T00:00:00Z'), now).unit).toBe('today');
  });

  it('counts days below the first calendar month', () => {
    expect(memberSince(new Date('2026-08-20T12:00:00Z'), now)).toEqual({
      unit: 'days',
      count: 12,
    });
  });

  it('switches to whole months on the monthly anniversary', () => {
    expect(memberSince(new Date('2026-08-01T12:00:00Z'), now)).toEqual({
      unit: 'months',
      count: 1,
    });
    expect(memberSince(new Date('2026-03-01T12:00:00Z'), now)).toEqual({
      unit: 'months',
      count: 6,
    });
  });

  it('stays on months one day before the monthly anniversary', () => {
    expect(memberSince(new Date('2026-08-02T12:00:00Z'), now)).toEqual({
      unit: 'days',
      count: 30,
    });
  });

  it('switches to whole years and never mixes in months or days', () => {
    expect(memberSince(new Date('2025-09-01T12:00:00Z'), now)).toEqual({
      unit: 'years',
      count: 1,
    });
    expect(memberSince(new Date('2024-06-15T12:00:00Z'), now)).toEqual({
      unit: 'years',
      count: 2,
    });
  });

  it('stays on months until the yearly anniversary is complete', () => {
    expect(memberSince(new Date('2025-09-15T12:00:00Z'), now)).toEqual({
      unit: 'months',
      count: 11,
    });
  });
});
