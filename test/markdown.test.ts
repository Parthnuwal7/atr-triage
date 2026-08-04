import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/dashboard/markdown.js';

describe('renderMarkdown', () => {
  it('escapes HTML before formatting (no injection)', () => {
    const html = renderMarkdown('a <script>alert(1)</script> b');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
  it('renders headings, bold, inline code, and bullet lists', () => {
    const md = [
      '# Title',
      '## Section',
      'Some **bold** and `code` text.',
      '- one',
      '- two',
    ].join('\n');
    const html = renderMarkdown(md);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Section</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toMatch(/<ul>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  });
  it('wraps prose lines in paragraphs and drops blank lines', () => {
    const html = renderMarkdown('line one\n\nline two');
    expect(html).toContain('<p>line one</p>');
    expect(html).toContain('<p>line two</p>');
  });
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });
});
