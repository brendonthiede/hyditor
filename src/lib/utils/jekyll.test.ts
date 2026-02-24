import { describe, expect, it } from 'vitest';
import { buildPostFilename, jekyllUrlForFile, parseSitePermalink, slugify } from './jekyll';

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

describe('parseSitePermalink', () => {
  it('returns the permalink value from valid config', () => {
    expect(parseSitePermalink('permalink: pretty\ntitle: My Site\n')).toBe('pretty');
  });

  it('returns a custom template from config', () => {
    expect(parseSitePermalink('permalink: /:categories/:year/:title/\n')).toBe(
      '/:categories/:year/:title/'
    );
  });

  it('defaults to date when no permalink key', () => {
    expect(parseSitePermalink('title: My Site\n')).toBe('date');
  });

  it('defaults to date on invalid YAML', () => {
    expect(parseSitePermalink('{')).toBe('date');
  });
});

describe('jekyllUrlForFile', () => {
  it('returns baseUrl for a non-markdown file', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/assets/style.css`)).toBe(BASE);
  });

  it('maps a _posts file to its dated permalink (default/date preset)', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-hello-world.md`)
    ).toBe(`${BASE}/2024/03/15/hello-world.html`);
  });

  it('maps a _posts file with categories to a category-prefixed URL', () => {
    const content = '---\ncategories: [devops]\n---\n\nContent';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2025-02-01-k8s-lab-on-linux.md`, content, 'date')
    ).toBe(`${BASE}/devops/2025/02/01/k8s-lab-on-linux.html`);
  });

  it('maps a _posts file with the pretty preset', () => {
    const content = '---\ncategories: [devops]\n---\n\nContent';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2025-02-01-k8s-lab-on-linux.md`, content, 'pretty')
    ).toBe(`${BASE}/devops/2025/02/01/k8s-lab-on-linux/`);
  });

  it('uses front matter permalink when present', () => {
    const content = '---\npermalink: /my/custom/path/\n---\n\nContent';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2025-02-01-some-post.md`, content)
    ).toBe(`${BASE}/my/custom/path/`);
  });

  it('maps a _drafts file to a dated permalink using today\'s UTC date', () => {
    const today = new Date();
    const y = today.getUTCFullYear();
    const m = String(today.getUTCMonth() + 1).padStart(2, '0');
    const d = String(today.getUTCDate()).padStart(2, '0');
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_drafts/my-draft-post.md`)
    ).toBe(`${BASE}/${y}/${m}/${d}/my-draft-post.html`);
  });

  it('returns baseUrl for files in non-served underscore directories', () => {
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
