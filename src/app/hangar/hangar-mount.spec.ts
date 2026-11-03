import type { CodexItemPort } from '../codex/codex.types';
import { codexGuidToUexUuid } from '../codex/uex-shop.service';
import { firstFittingPort } from './hangar-mount';

function port(portName: string, types: string[], minSize: number, maxSize: number): CodexItemPort {
  return { parentClassName: 'S', parentKind: 'ship', portName, minSize, maxSize, types, flags: [], portIndex: 0, helperName: null } as unknown as CodexItemPort;
}

describe('firstFittingPort (?mount= on the HQ ship)', () => {
  const ports = [port('hardpoint_shield', ['Shield'], 1, 1), port('hardpoint_gun_left', ['WeaponGun'], 1, 2), port('hardpoint_gun_nose', ['WeaponGun'], 3, 3)];

  it('picks the first port whose type and size take the piece', () => {
    expect(firstFittingPort(ports, { kind: 'weapon', attachType: 'WeaponGun', size: 3 })).toBe('hardpoint_gun_nose');
    expect(firstFittingPort(ports, { kind: 'weapon', attachType: 'weapongun', size: 2 })).toBe('hardpoint_gun_left');
  });
  it('null when no port fits, the type is unknown or the piece is not mountable', () => {
    expect(firstFittingPort(ports, { kind: 'weapon', attachType: 'WeaponGun', size: 5 })).toBeNull();
    expect(firstFittingPort(ports, { kind: 'component', attachType: null, size: 1 })).toBeNull();
    expect(firstFittingPort([], { kind: 'component', attachType: 'Shield', size: 1 })).toBeNull();
  });
});

describe('codexGuidToUexUuid (Bezugsquelle for ships)', () => {
  it('maps the codex word order to the UEX uuid (100i, verified against both APIs)', () => {
    expect(codexGuidToUexUuid('4cb14f49-a874-6135-2b1f-99e58157299f')).toBe('6135a874-4cb1-4f49-9f29-5781e5991f2b');
  });
  it('empty for a malformed guid', () => {
    expect(codexGuidToUexUuid('nope')).toBe('');
    expect(codexGuidToUexUuid(null)).toBe('');
  });
});
