import { describe, expect, it } from 'vitest';
import { buildPostFilename, slugify } from './jekyll';

describe('jekyll utils', () => {
  it('slugifies text into a stable post slug', () => {
    expect(slugify('  Hello, Jekyll World!  ')).toBe('hello-jekyll-world');
  });

  it('builds date-prefixed post filename', () => {
    const date = new Date('2026-02-22T00:00:00Z');
    expect(buildPostFilename(date, 'My First Post')).toBe('2026-02-22-my-first-post.md');
  });
});
