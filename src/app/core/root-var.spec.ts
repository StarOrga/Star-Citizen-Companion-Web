import { claimRootAttr } from './root-var';

describe('claimRootAttr', () => {
  const name = 'data-sc-spec-claim';
  afterEach(() => document.documentElement.removeAttribute(name));

  it('mirrors the newest claim and clears with the last release', () => {
    const a = {};
    const b = {};
    claimRootAttr(name, a, 'one');
    expect(document.documentElement.getAttribute(name)).toBe('one');
    claimRootAttr(name, b, 'two');
    expect(document.documentElement.getAttribute(name)).toBe('two');
    // The older owner leaving (a layout swap) keeps the newer one's value.
    claimRootAttr(name, a, null);
    expect(document.documentElement.getAttribute(name)).toBe('two');
    claimRootAttr(name, b, null);
    expect(document.documentElement.hasAttribute(name)).toBe(false);
  });

  it('does not touch the attribute when the value stays the same', () => {
    const a = {};
    claimRootAttr(name, a, 'x');
    const seen: MutationRecord[] = [];
    const mo = new MutationObserver((r) => seen.push(...r));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: [name] });
    claimRootAttr(name, a, 'x');
    mo.takeRecords().forEach((r) => seen.push(r));
    mo.disconnect();
    expect(seen.length).toBe(0);
    claimRootAttr(name, a, null);
  });
});
