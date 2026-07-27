import { renderFeedbackBody } from './markdown.util';

/** Convenience: most cases only care about the rendered text flow. */
const html = (src: string) => renderFeedbackBody(src).html;

describe('renderFeedbackBody', () => {
  it('wraps plain text in a paragraph', () => {
    expect(html('hello world')).toBe('<p>hello world</p>');
  });

  it('joins soft line breaks with <br> inside a paragraph', () => {
    expect(html('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('splits paragraphs on a blank line', () => {
    expect(html('a\n\nb')).toBe('<p>a</p><p>b</p>');
  });

  it('renders unordered lists', () => {
    expect(html('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders ordered lists', () => {
    expect(html('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
  });

  it('renders headings at h3–h5', () => {
    expect(html('# H')).toBe('<h3>H</h3>');
    expect(html('### H')).toBe('<h5>H</h5>');
  });

  it('renders bold, italic and inline code', () => {
    expect(html('**b** and *i* and `c`')).toBe(
      '<p><strong>b</strong> and <em>i</em> and <code>c</code></p>',
    );
  });

  it('renders http(s) links only', () => {
    expect(html('[x](https://a.b)')).toBe(
      '<p><a href="https://a.b" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    // javascript: scheme is rejected and left as literal text
    expect(html('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
  });

  it('escapes HTML so raw markup cannot reach the DOM', () => {
    expect(html('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });

  it('escapes HTML inside inline code', () => {
    expect(html('`<b>`')).toBe('<p><code>&lt;b&gt;</code></p>');
  });

  it('renders blockquotes', () => {
    expect(html('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('handles empty / nullish input', () => {
    expect(renderFeedbackBody('')).toEqual({ html: '', images: [] });
    expect(renderFeedbackBody(undefined as unknown as string)).toEqual({ html: '', images: [] });
  });

  // ── Images: lifted out of the flow (feedback a660536a) ────────────────────
  describe('images', () => {
    it('never emits an <img> into the HTML', () => {
      expect(html('![shot](https://a.b/x.png)')).not.toContain('<img');
    });

    it('collects trusted images (https and data:image URIs) instead', () => {
      expect(renderFeedbackBody('![shot](https://a.b/x.png)')).toEqual({
        html: '',
        images: [{ src: 'https://a.b/x.png', alt: 'shot' }],
      });
      const data = 'data:image/jpeg;base64,/9j/4AAQ';
      expect(renderFeedbackBody(`![](${data})`)).toEqual({
        html: '',
        images: [{ src: data, alt: '' }],
      });
    });

    it('keeps the src raw so it survives a property binding', () => {
      // An escaped `&amp;` would break a signed URL fed to [src].
      const src = 'https://a.b/x.png?token=1&sig=2';
      expect(renderFeedbackBody(`![](${src})`).images).toEqual([{ src, alt: '' }]);
    });

    it('pulls an image out of the middle of a text run, keeping the rest', () => {
      const out = renderFeedbackBody('a ![p](https://a.b/x.png) *b*');
      expect(out.html).toBe('<p>a  <em>b</em></p>');
      expect(out.images).toEqual([{ src: 'https://a.b/x.png', alt: 'p' }]);
    });

    it('collects several images in source order, across paragraphs', () => {
      const out = renderFeedbackBody(
        'intro\n\n![one](https://a.b/1.png)\n\n![two](https://a.b/2.png)',
      );
      expect(out.html).toBe('<p>intro</p>');
      expect(out.images.map((i) => i.alt)).toEqual(['one', 'two']);
    });

    it('drops the block an image leaves empty — no stray <p>/<li>', () => {
      expect(html('![a](https://a.b/1.png)')).toBe('');
      expect(html('- ![a](https://a.b/1.png)\n- text')).toBe('<ul><li>text</li></ul>');
      expect(html('> ![a](https://a.b/1.png)')).toBe('');
      expect(html('# ![a](https://a.b/1.png)')).toBe('');
    });

    it('rejects untrusted image schemes — no <img>, nothing collected', () => {
      // A non-image data: URI and a javascript: URI are refused by *both* the
      // image and link passes, so they survive as literal text.
      expect(renderFeedbackBody('![x](data:text/html;base64,PHNjcmlwdD4=)')).toEqual({
        html: '<p>![x](data:text/html;base64,PHNjcmlwdD4=)</p>',
        images: [],
      });
      expect(renderFeedbackBody('![x](javascript:alert(1))')).toEqual({
        html: '<p>![x](javascript:alert(1))</p>',
        images: [],
      });
      // An http (non-TLS) src is rejected as an image; the remaining [x](http://…)
      // is still a valid link, so it degrades to a link.
      const out = renderFeedbackBody('![x](http://a.b/x.png)');
      expect(out.images).toEqual([]);
      expect(out.html).toBe(
        '<p>!<a href="http://a.b/x.png" target="_blank" rel="noopener noreferrer">x</a></p>',
      );
    });

    it('leaves image markup inside inline code alone', () => {
      const out = renderFeedbackBody('`![a](https://a.b/1.png)`');
      expect(out.images).toEqual([]);
      expect(out.html).toBe('<p><code>![a](https://a.b/1.png)</code></p>');
    });

    it('returns a stable reference for the same body (memoised)', () => {
      const src = 'memo ![a](https://a.b/memo.png)';
      expect(renderFeedbackBody(src)).toBe(renderFeedbackBody(src));
    });
  });
});
