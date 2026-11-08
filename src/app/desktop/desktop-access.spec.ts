import {
  DESKTOP_CONNECTION_WINDOW_MS,
  DOWNLOAD_RING,
  connectionState,
  daysSinceSeen,
  isRestrictedProduct,
  ringsForRole,
} from './desktop-access';

const NOW = Date.parse('2026-08-23T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

describe('ringsForRole', () => {
  it('hands out stable and nothing else — pre-release rings are picked in the app', () => {
    expect(DOWNLOAD_RING).toBe('stable');
    for (const role of ['admin', 'collaborator', 'viewer', null]) {
      for (const product of ['uploader', 'starscape'] as const) {
        const rings = ringsForRole(product, role);
        expect(rings.every((r) => r === 'stable')).toBe(true);
      }
    }
  });

  it('lets admins and collaborators download the uploader', () => {
    expect(ringsForRole('uploader', 'admin')).toEqual(['stable']);
    expect(ringsForRole('uploader', 'collaborator')).toEqual(['stable']);
  });

  it('gives a viewer NOTHING for the uploader — the control must not render', () => {
    expect(ringsForRole('uploader', 'viewer')).toEqual([]);
  });

  it('treats an unknown role and an anonymous visitor as anon for the uploader', () => {
    expect(ringsForRole('uploader', null)).toEqual([]);
    expect(ringsForRole('uploader', undefined)).toEqual([]);
    expect(ringsForRole('uploader', 'nonsense')).toEqual([]);
  });

  it('lets every visitor take stable Starscape', () => {
    for (const role of [null, 'viewer', 'collaborator', 'admin']) {
      expect(ringsForRole('starscape', role)).toEqual(['stable']);
    }
  });
});

describe('the red-accent rules (admin feedback b8b31f24)', () => {
  it('calls the uploader restricted — a plain viewer is offered nothing', () => {
    expect(isRestrictedProduct('uploader')).toBe(true);
  });

  it('does NOT call Starscape restricted — every visitor may download it', () => {
    expect(isRestrictedProduct('starscape')).toBe(false);
  });
});

describe('connectionState — the 30-day window', () => {
  it('reports never without a check-in', () => {
    expect(connectionState(null, NOW)).toBe('never');
    expect(connectionState(undefined, NOW)).toBe('never');
    expect(connectionState('', NOW)).toBe('never');
    expect(connectionState('not-a-date', NOW)).toBe('never');
  });

  it('reports connected for a check-in one second inside the window', () => {
    const seen = new Date(NOW - DESKTOP_CONNECTION_WINDOW_MS + 1000).toISOString();
    expect(connectionState(seen, NOW)).toBe('connected');
  });

  it('reports connected exactly ON the 30-day boundary (inclusive)', () => {
    const seen = new Date(NOW - DESKTOP_CONNECTION_WINDOW_MS).toISOString();
    expect(connectionState(seen, NOW)).toBe('connected');
  });

  it('reports expired one second past the 30-day boundary', () => {
    const seen = new Date(NOW - DESKTOP_CONNECTION_WINDOW_MS - 1000).toISOString();
    expect(connectionState(seen, NOW)).toBe('expired');
  });

  it('reports expired for a long-abandoned install', () => {
    expect(connectionState(new Date(NOW - 400 * DAY).toISOString(), NOW)).toBe('expired');
  });

  it('treats a skewed future timestamp as connected, not expired', () => {
    expect(connectionState(new Date(NOW + 5 * DAY).toISOString(), NOW)).toBe('connected');
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(connectionState(new Date(NOW - DAY), NOW)).toBe('connected');
  });
});

describe('daysSinceSeen', () => {
  it('floors to whole days and never goes negative', () => {
    expect(daysSinceSeen(new Date(NOW - 90 * 60 * 1000).toISOString(), NOW)).toBe(0);
    expect(daysSinceSeen(new Date(NOW - DAY - 1000).toISOString(), NOW)).toBe(1);
    expect(daysSinceSeen(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe(30);
    expect(daysSinceSeen(new Date(NOW + DAY).toISOString(), NOW)).toBe(0);
  });

  it('is null without a check-in', () => {
    expect(daysSinceSeen(null, NOW)).toBeNull();
  });
});
