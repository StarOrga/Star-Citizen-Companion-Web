import { compareVersion, summarizeChannels } from './p4k-history.component';
import { ChannelTag, P4kBundleRow } from './p4k.service';

function row(p: {
  channel: ChannelTag;
  patch: string;
  quality?: number | null;
  entities?: Record<string, number>;
  created?: string;
}): P4kBundleRow {
  return {
    id: `${p.channel}-${p.patch}-${p.created ?? '0'}`,
    channel: p.channel,
    patch_version: p.patch,
    build_number: '1',
    schema_version: 1,
    quality_score: p.quality ?? null,
    entity_counts: p.entities ?? null,
    diff_summary: null,
    disabled: false,
    disabled_reason: null,
    tool_version: '0.4.5',
    uploaded_by_id: 'u',
    uploaded_by_email: 'u@example.com',
    uploaded_by_name: 'U',
    created_at: p.created ?? '2026-01-01T00:00:00Z',
  };
}

describe('compareVersion', () => {
  it('compares patch segments numerically, not lexically', () => {
    expect(compareVersion('4.8.0', '4.7.2')).toBeGreaterThan(0);
    expect(compareVersion('4.10.0', '4.9.0')).toBeGreaterThan(0); // lexical would say 4.9 > 4.10
    expect(compareVersion('4.8.0', '4.8.0')).toBe(0);
  });

  it('ignores non-numeric suffixes', () => {
    expect(compareVersion('4.8.0-ptu', '4.8.0')).toBe(0);
    expect(compareVersion('3.24.1', '3.24.0-eptu')).toBeGreaterThan(0);
  });
});

describe('summarizeChannels', () => {
  it('picks the patch-latest bundle per channel — by patch version, not upload date', () => {
    // Older patch uploaded LATER must NOT win over the newer patch.
    const bundles = [
      row({ channel: 'live', patch: '4.8.0', quality: 90, created: '2026-05-01T00:00:00Z' }),
      row({ channel: 'live', patch: '4.7.0', quality: 40, created: '2026-05-20T00:00:00Z' }),
    ];
    const [live] = summarizeChannels(bundles);
    expect(live.patch_version).toBe('4.8.0');
    expect(live.quality_score).toBe(90); // quality of the patch-latest, not the newer upload
  });

  it('orders live first, then remaining channels by patch version descending', () => {
    const bundles = [
      row({ channel: 'ptu', patch: '4.9.0' }),
      row({ channel: 'eptu', patch: '4.10.0' }),
      row({ channel: 'live', patch: '4.8.0' }),
      row({ channel: 'tech-preview', patch: '4.8.5' }),
    ];
    expect(summarizeChannels(bundles).map((c) => c.channel)).toEqual([
      'live', // always first regardless of its patch
      'eptu', // 4.10.0
      'ptu', // 4.9.0
      'tech-preview', // 4.8.5
    ]);
  });

  it('produces exactly one row per channel', () => {
    const bundles = [
      row({ channel: 'live', patch: '4.8.0', created: '2026-05-01T00:00:00Z' }),
      row({ channel: 'live', patch: '4.8.0', created: '2026-05-10T00:00:00Z' }),
      row({ channel: 'ptu', patch: '4.9.0' }),
    ];
    const summary = summarizeChannels(bundles);
    expect(summary.length).toBe(2);
    expect(new Set(summary.map((c) => c.channel)).size).toBe(2);
  });

  it('sums entity counts of the patch-latest bundle', () => {
    const bundles = [
      row({ channel: 'live', patch: '4.8.0', entities: { ships: 1493, weapons: 612 } }),
    ];
    expect(summarizeChannels(bundles)[0].entities).toBe(2105);
  });
});
