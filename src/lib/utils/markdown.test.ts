import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('markdown utils', () => {
  it('renders markdown heading and emphasis to HTML', () => {
    const html = renderMarkdown('# Title\n\n*text*');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<em>text</em>');
  });
});
