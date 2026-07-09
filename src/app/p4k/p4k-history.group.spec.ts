import { groupBundlesByPatch } from './p4k-history.component';
import { ChannelTag, P4kBundleRow } from './p4k.service';

function row(p: {
  channel: ChannelTag;
  patch: string;
  quality?: number | null;
  entities?: Record<string, number>;
  created?: string;
  disabled?: boolean;
  superseded?: boolean;
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
    disabled: p.disabled ?? false,
    disabled_reason: null,
    tool_version: '0.4.5',
    uploaded_by_id: 'u',
    uploaded_by_email: 'u@example.com',
    uploaded_by_name: 'U',
    created_at: p.created ?? '2026-01-01T00:00:00Z',
    superseded_at: p.superseded ? '2026-07-01T00:00:00Z' : null,
  };
}

describe('groupBundlesByPatch', () => {
  it('groups uploads by patch version, newest patch first', () => {
    const groups = groupBundlesByPatch([
      row({ channel: 'live', patch: '4.8.0' }),
      row({ channel: 'ptu', patch: '4.10.0' }),
      row({ channel: 'eptu', patch: '4.9.0' }),
    ]);
    expect(groups.map((g) => g.patch_version)).toEqual(['4.10.0', '4.9.0', '4.8.0']);
  });

  it('collects all uploads of a patch as its sub-uploads, newest upload first', () => {
    const groups = groupBundlesByPatch([
      row({ channel: 'live', patch: '4.8.0', created: '2026-05-01T00:00:00Z' }),
      row({ channel: 'ptu', patch: '4.8.0', created: '2026-05-10T00:00:00Z' }),
      row({ channel: 'eptu', patch: '4.8.0', created: '2026-05-05T00:00:00Z' }),
    ]);
    expect(groups.length).toBe(1);
    const g = groups[0];
    expect(g.uploadCount).toBe(3);
    expect(g.uploads.map((u) => u.created_at)).toEqual([
      '2026-05-10T00:00:00Z',
      '2026-05-05T00:00:00Z',
      '2026-05-01T00:00:00Z',
    ]);
    expect(g.latest_at).toBe('2026-05-10T00:00:00Z');
  });

  it('lists distinct channels live-first', () => {
    const groups = groupBundlesByPatch([
      row({ channel: 'eptu', patch: '4.8.0' }),
      row({ channel: 'live', patch: '4.8.0' }),
      row({ channel: 'ptu', patch: '4.8.0' }),
      row({ channel: 'live', patch: '4.8.0', created: '2026-02-01T00:00:00Z' }),
    ]);
    expect(groups[0].channels).toEqual(['live', 'ptu', 'eptu']);
  });

  it('takes representative quality/entities from the newest still-active upload', () => {
    const groups = groupBundlesByPatch([
      // newest upload is disabled → should be skipped for the representative metric
      row({ channel: 'live', patch: '4.8.0', quality: 30, entities: { ships: 5 }, created: '2026-05-20T00:00:00Z', disabled: true, superseded: true }),
      row({ channel: 'live', patch: '4.8.0', quality: 88, entities: { ships: 100, weapons: 20 }, created: '2026-05-10T00:00:00Z' }),
    ]);
    expect(groups[0].quality_score).toBe(88);
    expect(groups[0].entities).toBe(120);
  });

  it('flags a group as allSuperseded only when every upload is superseded history', () => {
    const allGone = groupBundlesByPatch([
      row({ channel: 'live', patch: '4.7.0', disabled: true, superseded: true }),
      row({ channel: 'ptu', patch: '4.7.0', disabled: true, superseded: true }),
    ]);
    expect(allGone[0].allSuperseded).toBe(true);

    const oneActive = groupBundlesByPatch([
      row({ channel: 'live', patch: '4.7.0', disabled: true, superseded: true }),
      row({ channel: 'ptu', patch: '4.7.0' }),
    ]);
    expect(oneActive[0].allSuperseded).toBe(false);
  });
});
