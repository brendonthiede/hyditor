import { describe, expect, it } from 'vitest';
import { buildPostFilename, jekyllUrlForFile, slugify } from './jekyll';

const BASE = 'http://127.0.0.1:4000';
const REPO = '/home/user/.cache/hyditor/repos/owner/my-site';

describe('jekyll utils', () => {
  it('slugifies text into a stable post slug', () => {
    expect(slugify('  Hello, Jekyll World!  ')).toBe('hello-jekyll-world');
  });

  it('builds date-prefixed post filename', () => {
    const date = new Date('2026-02-22T00:00:00Z');
    expect(buildPostFilename(date, 'My First Post')).toBe('2026-02-22-my-first-post.md');
  });
});

describe('jekyllUrlForFile', () => {
  it('returns baseUrl for a non-markdown file', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/assets/style.css`)).toBe(BASE);
  });

  it('maps a _posts file to its dated permalink', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-hello-world.md`)
    ).toBe(`${BASE}/2024/03/15/hello-world/`);
  });

  it('maps a _drafts file to a dated permalink using today\'s UTC date', () => {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_drafts/my-draft-post.md`)
    ).toBe(`${BASE}/${y}/${m}/${d}/my-draft-post/`);
  });

  it('returns baseUrl for files in other underscore directories', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/_layouts/default.md`)).toBe(BASE);
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/_includes/header.md`)).toBe(BASE);
  });

  it('maps index.md to the root URL', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/index.md`)).toBe(`${BASE}/`);
  });

  it('maps a top-level page to a pretty URL', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/about.md`)).toBe(`${BASE}/about/`);
  });

  it('maps a nested page to a pretty URL', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/docs/getting-started.md`)
    ).toBe(`${BASE}/docs/getting-started/`);
  });

  it('returns baseUrl when the file is outside the repo', () => {
    expect(jekyllUrlForFile(BASE, REPO, '/some/other/path/page.md')).toBe(BASE);
  });
});
