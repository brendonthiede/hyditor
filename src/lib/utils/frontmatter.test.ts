import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from './frontmatter';

describe('frontmatter utils', () => {
  it('extracts YAML front matter from markdown content', () => {
    const input = `---\ntitle: Example\npublished: true\n---\n\nBody copy`;
    const result = parseFrontmatter(input);

    expect(result.data.title).toBe('Example');
    expect(result.data.published).toBe(true);
    expect(result.content.trim()).toBe('Body copy');
  });
});
