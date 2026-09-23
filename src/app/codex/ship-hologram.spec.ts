import { HoloMaterial, applyHologram, parseRgbToken } from './ship-hologram';

interface Recorded {
  cleared: number;
  base?: number[];
  emissive?: number[];
  alphaMode: string;
}

function fakeMaterial(name: string, alphaMode = 'OPAQUE', alpha = 1): [HoloMaterial, Recorded] {
  const rec: Recorded = { cleared: 0, alphaMode };
  const slot = { setTexture: () => rec.cleared++ };
  const mat: HoloMaterial = {
    name,
    pbrMetallicRoughness: {
      baseColorFactor: [1, 1, 1, alpha],
      setBaseColorFactor: (v) => (rec.base = v),
      setMetallicFactor: () => undefined,
      setRoughnessFactor: () => undefined,
      baseColorTexture: slot,
      metallicRoughnessTexture: slot,
    },
    normalTexture: slot,
    occlusionTexture: slot,
    emissiveTexture: slot,
    setEmissiveFactor: (v) => (rec.emissive = v),
    getAlphaMode: () => rec.alphaMode,
    setAlphaMode: (m) => (rec.alphaMode = m),
  };
  return [mat, rec];
}

describe('applyHologram', () => {
  it('drops every texture slot, so no CIG texture art is ever drawn', () => {
    const [mat, rec] = fakeMaterial('greeble');
    applyHologram([mat], [77, 208, 225]);
    expect(rec.cleared).toBe(5);
  });

  it('keeps an alpha-hidden proxy hidden and makes the rest opaque', () => {
    const [proxy, p] = fakeMaterial('proxy', 'MASK', 0.1);
    const [decal, d] = fakeMaterial('decals_diff', 'MASK', 0.8);
    applyHologram([proxy, decal], [77, 208, 225]);
    expect(p.alphaMode).toBe('MASK');
    expect(p.base?.[3]).toBe(0.1);
    expect(d.alphaMode).toBe('OPAQUE');
    expect(d.base?.[3]).toBe(1);
  });

  it('lets light sources glow brighter than the hull', () => {
    const [hull, h] = fakeMaterial('dark_panels');
    const [glow, g] = fakeMaterial('glows');
    applyHologram([hull, glow], [77, 208, 225]);
    expect(g.emissive![2]).toBeGreaterThan(h.emissive![2]);
  });
});

describe('parseRgbToken', () => {
  it('reads an "r, g, b" token and rejects anything else', () => {
    expect(parseRgbToken(' 77, 208, 225')).toEqual([77, 208, 225]);
    expect(parseRgbToken('')).toBeNull();
    expect(parseRgbToken('#4dd0e1')).toBeNull();
  });
});
