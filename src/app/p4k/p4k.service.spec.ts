import { detectChannel, detectVersion } from './p4k.service';

describe('p4k filename heuristics', () => {
  it('detects live channel', () => {
    expect(detectChannel('StarCitizen_LIVE_Data.p4k')).toBe('live');
    expect(detectChannel('sc.live.slice.zip')).toBe('live');
  });

  it('detects ptu / eptu / tech-preview', () => {
    expect(detectChannel('PTU_Data.p4k')).toBe('ptu');
    expect(detectChannel('eptu-4.0.slice.zip')).toBe('eptu');
    expect(detectChannel('Tech-Preview_Data.p4k')).toBe('tech-preview');
  });

  it('returns unknown for opaque names', () => {
    expect(detectChannel('random-file.bin')).toBe('unknown');
    expect(detectChannel('Data.p4k')).toBe('unknown');
  });

  it('extracts semver-ish version tokens with optional suffix', () => {
    // Regex intentionally captures channel-suffix to preserve context (live/ptu/eptu hint).
    expect(detectVersion('StarCitizen-3.24.1-LIVE.p4k')).toBe('3.24.1-LIVE');
    expect(detectVersion('sc_4.0_eptu.zip')).toBe('4.0_eptu');
    expect(detectVersion('plain-3.24.zip')).toBe('3.24');
    expect(detectVersion('no_version_here.bin')).toBeNull();
  });
});
