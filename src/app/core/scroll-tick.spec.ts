import { flushScrollTick, onScrollTick, scrollTickSize } from './scroll-tick';

describe('onScrollTick', () => {
  const offs: (() => void)[] = [];
  afterEach(() => {
    offs.splice(0).forEach((off) => off());
  });

  it('runs every read of a frame before any write, once per frame however many events came', () => {
    const log: string[] = [];
    offs.push(onScrollTick({ read: () => log.push('a:read'), write: () => log.push('a:write') }));
    offs.push(onScrollTick({ read: () => log.push('b:read'), write: () => log.push('b:write') }));
    offs.push(onScrollTick(() => log.push('c')));
    document.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));
    flushScrollTick();
    expect(log).toEqual(['a:read', 'b:read', 'a:write', 'b:write', 'c']);
  });

  it('keeps page, any-target and element subscribers apart', () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const hits: string[] = [];
    offs.push(onScrollTick(() => hits.push('page')));
    offs.push(onScrollTick(() => hits.push('any'), { anyTarget: true }));
    offs.push(onScrollTick(() => hits.push('box'), { target: box }));
    box.dispatchEvent(new Event('scroll'));
    flushScrollTick();
    expect(hits.sort()).toEqual(['any', 'box']);
    hits.length = 0;
    document.dispatchEvent(new Event('scroll'));
    flushScrollTick();
    expect(hits.sort()).toEqual(['any', 'page']);
    box.remove();
  });

  it('a failing subscriber does not stop the others; unsubscribing detaches', () => {
    let ran = false;
    offs.push(onScrollTick(() => { throw new Error('boom'); }));
    offs.push(onScrollTick(() => (ran = true)));
    document.dispatchEvent(new Event('scroll'));
    flushScrollTick();
    expect(ran).toBe(true);
    offs.splice(0).forEach((off) => off());
    expect(scrollTickSize()).toBe(0);
  });
});
