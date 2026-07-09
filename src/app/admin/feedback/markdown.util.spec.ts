import { renderMarkdown } from './markdown.util';

describe('renderMarkdown', () => {
  it('wraps plain text in a paragraph', () => {
    expect(renderMarkdown('hello world')).toBe('<p>hello world</p>');
  });

  it('joins soft line breaks with <br> inside a paragraph', () => {
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one<br>line two</p>');
  });

  it('splits paragraphs on a blank line', () => {
    expect(renderMarkdown('a\n\nb')).toBe('<p>a</p><p>b</p>');
  });

  it('renders unordered lists', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders ordered lists', () => {
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>');
  });

  it('renders headings at h3–h5', () => {
    expect(renderMarkdown('# H')).toBe('<h3>H</h3>');
    expect(renderMarkdown('### H')).toBe('<h5>H</h5>');
  });

  it('renders bold, italic and inline code', () => {
    expect(renderMarkdown('**b** and *i* and `c`')).toBe(
      '<p><strong>b</strong> and <em>i</em> and <code>c</code></p>',
    );
  });

  it('renders http(s) links only', () => {
    expect(renderMarkdown('[x](https://a.b)')).toBe(
      '<p><a href="https://a.b" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
    // javascript: scheme is rejected and left as literal text
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>');
  });

  it('renders trusted images (https and data:image URIs)', () => {
    expect(renderMarkdown('![shot](https://a.b/x.png)')).toBe(
      '<p><img src="https://a.b/x.png" alt="shot" loading="lazy"></p>',
    );
    const data = 'data:image/jpeg;base64,/9j/4AAQ';
    expect(renderMarkdown(`![](${data})`)).toBe(
      `<p><img src="${data}" alt="" loading="lazy"></p>`,
    );
  });

  it('rejects untrusted image schemes — never emits an <img> for them', () => {
    // A non-image data: URI and a javascript: URI are refused by *both* the
    // image and link passes, so they survive as literal text.
    expect(renderMarkdown('![x](data:text/html;base64,PHNjcmlwdD4=)')).toBe(
      '<p>![x](data:text/html;base64,PHNjcmlwdD4=)</p>',
    );
    expect(renderMarkdown('![x](javascript:alert(1))')).toBe('<p>![x](javascript:alert(1))</p>');
    // An http (non-TLS) src is rejected as an image; the remaining [x](http://…)
    // is still a valid link, so it degrades to a link — crucially, no <img>.
    const http = renderMarkdown('![x](http://a.b/x.png)');
    expect(http).not.toContain('<img');
    expect(http).toBe(
      '<p>!<a href="http://a.b/x.png" target="_blank" rel="noopener noreferrer">x</a></p>',
    );
  });

  it('does not let formatting corrupt an emitted image src', () => {
    // Underscores/asterisks that might appear near an image must not wrap tags.
    expect(renderMarkdown('a ![p](https://a.b/x.png) *b*')).toBe(
      '<p>a <img src="https://a.b/x.png" alt="p" loading="lazy"> <em>b</em></p>',
    );
  });

  it('escapes HTML so raw markup cannot reach the DOM', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    );
  });

  it('escapes HTML inside inline code', () => {
    expect(renderMarkdown('`<b>`')).toBe('<p><code>&lt;b&gt;</code></p>');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('handles empty / nullish input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown(undefined as unknown as string)).toBe('');
  });
});
