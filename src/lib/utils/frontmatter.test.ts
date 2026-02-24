import { describe, expect, it } from 'vitest';
import {
  parseFrontmatter,
  removeFrontmatterField,
  renameFrontmatterField,
  upsertFrontmatterField
} from './frontmatter';

describe('frontmatter utils', () => {
  it('extracts YAML front matter from markdown content', () => {
    const input = `---\ntitle: Example\npublished: true\n---\n\nBody copy`;
    const result = parseFrontmatter(input);

    expect(result.data.title).toBe('Example');
    expect(result.data.published).toBe(true);
    expect(result.content.trim()).toBe('Body copy');
  });

  it('upserts and parses typed values for front matter fields', () => {
    const input = `---\ntitle: Example\n---\n\nBody copy`;
    const updated = upsertFrontmatterField(input, 'draft', 'false');
    const parsed = parseFrontmatter(updated);

    expect(parsed.data.title).toBe('Example');
    expect(parsed.data.draft).toBe(false);
    expect(parsed.content.trim()).toBe('Body copy');
  });

  it('renames a front matter field and preserves its value', () => {
    const input = `---\ntitle: Example\n---\n\nBody copy`;
    const renamed = renameFrontmatterField(input, 'title', 'headline');
    const parsed = parseFrontmatter(renamed);

    expect(parsed.data.title).toBeUndefined();
    expect(parsed.data.headline).toBe('Example');
  });

  it('removes a front matter field', () => {
    const input = `---\ntitle: Example\ntags:\n  - docs\n---\n\nBody copy`;
    const removed = removeFrontmatterField(input, 'title');
    const parsed = parseFrontmatter(removed);

    expect(parsed.data.title).toBeUndefined();
    expect(parsed.data.tags).toEqual(['docs']);
  });
});
