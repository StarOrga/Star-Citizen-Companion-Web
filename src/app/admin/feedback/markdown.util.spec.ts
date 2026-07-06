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
