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

describe('parseFrontmatter edge cases', () => {
  it('returns empty data and full content when no front matter exists', () => {
    const input = 'Just a plain body with no front matter.';
    const result = parseFrontmatter(input);

    expect(result.data).toEqual({});
    expect(result.content).toBe(input);
  });

  it('returns empty data for invalid/unparseable YAML', () => {
    const input = `---\n: [invalid yaml\n---\n\nBody`;
    const result = parseFrontmatter(input);

    expect(result.data).toEqual({});
  });

  it('returns empty data when YAML parses to an array', () => {
    const input = `---\n- item1\n- item2\n---\n\nBody`;
    const result = parseFrontmatter(input);

    expect(result.data).toEqual({});
    expect(result.content.trim()).toBe('Body');
  });

  it('returns empty data when YAML parses to a scalar', () => {
    const input = `---\njust a string\n---\n\nBody`;
    const result = parseFrontmatter(input);

    expect(result.data).toEqual({});
  });

  it('handles Windows-style CRLF line endings', () => {
    const input = '---\r\ntitle: CRLF\r\n---\r\n\r\nBody with CRLF';
    const result = parseFrontmatter(input);

    expect(result.data.title).toBe('CRLF');
    expect(result.content.trim()).toBe('Body with CRLF');
  });

  it('handles empty string input', () => {
    const result = parseFrontmatter('');
    expect(result.data).toEqual({});
    expect(result.content).toBe('');
  });
});

describe('upsertFrontmatterField type coercion', () => {
  const base = `---\ntitle: Test\n---\n\nBody`;

  it('coerces "true" to boolean true', () => {
    const updated = upsertFrontmatterField(base, 'flag', 'true');
    expect(parseFrontmatter(updated).data.flag).toBe(true);
  });

  it('coerces "false" to boolean false', () => {
    const updated = upsertFrontmatterField(base, 'flag', 'false');
    expect(parseFrontmatter(updated).data.flag).toBe(false);
  });

  it('coerces "null" to null', () => {
    const updated = upsertFrontmatterField(base, 'field', 'null');
    expect(parseFrontmatter(updated).data.field).toBeNull();
  });

  it('coerces numeric strings to numbers', () => {
    const updated = upsertFrontmatterField(base, 'count', '42');
    expect(parseFrontmatter(updated).data.count).toBe(42);
  });

  it('coerces float strings to numbers', () => {
    const updated = upsertFrontmatterField(base, 'ratio', '3.14');
    expect(parseFrontmatter(updated).data.ratio).toBe(3.14);
  });

  it('preserves empty string as empty string', () => {
    const updated = upsertFrontmatterField(base, 'empty', '');
    expect(parseFrontmatter(updated).data.empty).toBe('');
  });

  it('preserves regular strings as-is', () => {
    const updated = upsertFrontmatterField(base, 'name', 'hello world');
    expect(parseFrontmatter(updated).data.name).toBe('hello world');
  });

  it('creates front matter when none exists', () => {
    const plain = 'Just body text';
    const updated = upsertFrontmatterField(plain, 'title', 'New');
    const parsed = parseFrontmatter(updated);

    expect(parsed.data.title).toBe('New');
    expect(parsed.content.trim()).toBe('Just body text');
  });

  it('is a no-op for empty key', () => {
    const result = upsertFrontmatterField(base, '', 'value');
    expect(result).toBe(base);
  });

  it('is a no-op for whitespace-only key', () => {
    const result = upsertFrontmatterField(base, '   ', 'value');
    expect(result).toBe(base);
  });
});

describe('renameFrontmatterField edge cases', () => {
  const base = `---\ntitle: Test\nauthor: Alice\n---\n\nBody`;

  it('returns content unchanged when previous key does not exist', () => {
    const result = renameFrontmatterField(base, 'nonexistent', 'newkey');
    expect(result).toBe(base);
  });

  it('returns content unchanged when previous == next', () => {
    const result = renameFrontmatterField(base, 'title', 'title');
    expect(result).toBe(base);
  });

  it('returns content unchanged when keys are empty', () => {
    expect(renameFrontmatterField(base, '', 'new')).toBe(base);
    expect(renameFrontmatterField(base, 'title', '')).toBe(base);
  });
});

describe('removeFrontmatterField edge cases', () => {
  it('returns content unchanged when key does not exist', () => {
    const input = `---\ntitle: Test\n---\n\nBody`;
    const result = removeFrontmatterField(input, 'nonexistent');
    expect(result).toBe(input);
  });

  it('strips front matter block entirely when removing the last key', () => {
    const input = `---\ntitle: Only Key\n---\n\nBody`;
    const result = removeFrontmatterField(input, 'title');
    const parsed = parseFrontmatter(result);

    expect(parsed.data).toEqual({});
    expect(parsed.content.trim()).toBe('Body');
    // Should not have a --- block anymore
    expect(result.startsWith('---')).toBe(false);
  });

  it('returns content unchanged for empty key', () => {
    const input = `---\ntitle: Test\n---\n\nBody`;
    expect(removeFrontmatterField(input, '')).toBe(input);
  });
});

describe('round-trip fidelity', () => {
  it('parse → upsert → parse preserves existing fields', () => {
    const input = `---\ntitle: Hello\ntags:\n  - a\n  - b\n---\n\nBody`;
    const updated = upsertFrontmatterField(input, 'draft', 'true');
    const parsed = parseFrontmatter(updated);

    expect(parsed.data.title).toBe('Hello');
    expect(parsed.data.tags).toEqual(['a', 'b']);
    expect(parsed.data.draft).toBe(true);
    expect(parsed.content.trim()).toBe('Body');
  });
});
