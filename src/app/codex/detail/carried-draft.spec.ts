import { carriedWithDraft, CarriedItem } from './carried-draft';

const item = (name: string): CarriedItem => ({ kind: 'weapon', payload: { name }, ammoPayload: undefined });
const names = (out: CarriedItem[]) => out.map((o) => (o.payload as { name: string }).name);

describe('carriedWithDraft (round-7 E9)', () => {
  const carried = new Map([
    ['gun_left', 'GAT_S3'],
    ['gun_right', 'GAT_S3'],
  ]);
  const stock = (c: string) => item(`stock:${c}`);

  it('keeps the stock occupants when the draft does not touch the mount', () => {
    expect(names(carriedWithDraft('hp_mount', carried, new Map(), stock, () => null))).toEqual(['stock:GAT_S3', 'stock:GAT_S3']);
  });

  it('a nested swap replaces exactly that sub-slot — the stat no longer reads the stock gun', () => {
    const draft = new Map<string, string | null>([['hp_mount.gun_left', 'REV_S3']]);
    const out = carriedWithDraft('hp_mount', carried, draft, stock, (_p, v) => item(`draft:${v}`));
    expect(names(out)).toEqual(['draft:REV_S3', 'stock:GAT_S3']);
  });

  it('an emptied sub-slot and a still-loading swap contribute nothing', () => {
    const draft = new Map<string, string | null>([
      ['hp_mount.gun_left', null],
      ['hp_mount.gun_right', 'REV_S3'],
    ]);
    expect(carriedWithDraft('hp_mount', carried, draft, stock, () => 'pending')).toEqual([]);
  });
});
