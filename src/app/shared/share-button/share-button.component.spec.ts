import { currentAnchor, shareUrl } from './share-button.component';

describe('share button helpers', () => {
  it('builds the URL from path, query and the current anchor', () => {
    const loc = { origin: 'https://x.test', pathname: '/verse/news/a', search: '?q=1' };
    expect(shareUrl(loc, 'pd-fixed')).toBe('https://x.test/verse/news/a?q=1#pd-fixed');
    expect(shareUrl(loc, null)).toBe('https://x.test/verse/news/a?q=1');
  });

  it('picks the last heading above the reading line', () => {
    const host = document.createElement('div');
    host.innerHTML = '<h2 id="one">1</h2><h3 id="two">2</h3><h3 id="three">3</h3>';
    document.body.appendChild(host);
    try {
      const [a, b, c] = Array.from(host.querySelectorAll('[id]')) as HTMLElement[];
      a.getBoundingClientRect = () => ({ top: -300 }) as DOMRect;
      b.getBoundingClientRect = () => ({ top: 60 }) as DOMRect;
      c.getBoundingClientRect = () => ({ top: 900 }) as DOMRect;
      expect(currentAnchor(host, 140)).toBe('two');
      b.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
      expect(currentAnchor(host, 140)).toBe('one');
    } finally {
      host.remove();
    }
  });
});
