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

describe('slugify edge cases', () => {
  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('handles all-special-characters input', () => {
    expect(slugify('!@#$%^&*()')).toBe('');
  });

  it('collapses consecutive hyphens', () => {
    expect(slugify('hello---world')).toBe('hello-world');
  });

  it('handles unicode by stripping non-ascii', () => {
    expect(slugify('café résumé')).toBe('caf-rsum');
  });

  it('trims leading and trailing hyphens from spaces', () => {
    expect(slugify('  hello  ')).toBe('hello');
  });
});

describe('buildPostFilename edge cases', () => {
  it('handles title with special characters', () => {
    const date = new Date('2026-01-15T00:00:00Z');
    expect(buildPostFilename(date, 'Hello, World! #1')).toBe('2026-01-15-hello-world-1.md');
  });

  it('handles empty title', () => {
    const date = new Date('2026-03-01T00:00:00Z');
    expect(buildPostFilename(date, '')).toBe('2026-03-01-.md');
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

  it('defaults to date for empty string', () => {
    expect(parseSitePermalink('')).toBe('date');
  });

  it('defaults to date when permalink is empty string', () => {
    expect(parseSitePermalink('permalink: ""\n')).toBe('date');
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

  it('maps a _drafts file to a dated permalink using today\'s local date', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_drafts/my-draft-post.md`)
    ).toBe(`${BASE}/${y}/${m}/${d}/my-draft-post.html`);
  });

  it('strips date prefix from a date-prefixed draft filename', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_drafts/2021-03-05-get-started-with-shipa.md`)
    ).toBe(`${BASE}/${y}/${m}/${d}/get-started-with-shipa.html`);
  });

  it('uses local time when front matter date contains a timezone offset', () => {
    // Jekyll (Ruby) interprets front matter dates in local time.
    // A UTC datetime like 2019-06-16T02:35:18.594Z may be June 15 locally.
    const fmDate = '2019-06-16T02:35:18.594Z';
    const d = new Date(fmDate);
    const y = String(d.getFullYear());
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    const content = `---\ndate: "${fmDate}"\ncategories: [devops]\n---\n`;
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2019-06-15-openstack-on-azure.md`, content, 'date')
    ).toBe(`${BASE}/devops/${y}/${mo}/${dy}/openstack-on-azure.html`);
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

  // .markdown extension support
  it('maps a .markdown _posts file to its dated permalink', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-hello-world.markdown`)
    ).toBe(`${BASE}/2024/03/15/hello-world.html`);
  });

  it('maps a .markdown _drafts file to a dated permalink using today\'s local date', () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_drafts/my-draft-post.markdown`)
    ).toBe(`${BASE}/${y}/${m}/${d}/my-draft-post.html`);
  });

  it('maps a .markdown top-level page to a pretty URL', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/about.markdown`)).toBe(`${BASE}/about/`);
  });

  it('maps index.markdown to the root URL', () => {
    expect(jekyllUrlForFile(BASE, REPO, `${REPO}/index.markdown`)).toBe(`${BASE}/`);
  });

  it('maps a .markdown _posts file with categories', () => {
    const content = '---\ncategories: [devops]\n---\n\nContent';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2025-02-01-k8s-lab.markdown`, content, 'date')
    ).toBe(`${BASE}/devops/2025/02/01/k8s-lab.html`);
  });
});

describe('jekyllUrlForFile — ordinal preset', () => {
  it('uses year and day-of-year in the URL', () => {
    // 2024-03-15 is the 75th day of the year (leap year)
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-hello-world.md`, '', 'ordinal')
    ).toBe(`${BASE}/2024/75/hello-world.html`);
  });

  it('uses day-of-year 1 for January 1', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2025-01-01-new-year.md`, '', 'ordinal')
    ).toBe(`${BASE}/2025/1/new-year.html`);
  });

  it('includes categories with ordinal preset', () => {
    const content = '---\ncategories: [tech]\n---\n';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-hello.md`, content, 'ordinal')
    ).toBe(`${BASE}/tech/2024/75/hello.html`);
  });
});

describe('jekyllUrlForFile — none preset', () => {
  it('uses only categories and title (no date segments)', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-hello-world.md`, '', 'none')
    ).toBe(`${BASE}/hello-world.html`);
  });

  it('includes categories with none preset', () => {
    const content = '---\ncategories: [docs, guides]\n---\n';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-03-15-setup.md`, content, 'none')
    ).toBe(`${BASE}/docs/guides/setup.html`);
  });
});

describe('jekyllUrlForFile — slug vs title', () => {
  it('uses front matter slug for :slug but filename title for :title', () => {
    const content = '---\nslug: custom-slug\n---\n';
    // The default "date" template uses :title (not :slug)
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-01-10-my-post.md`, content, 'date')
    ).toBe(`${BASE}/2024/01/10/my-post.html`);
  });

  it('uses slug in custom template with :slug placeholder', () => {
    const content = '---\nslug: custom-slug\n---\n';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-01-10-my-post.md`, content, '/:year/:slug/')
    ).toBe(`${BASE}/2024/custom-slug/`);
  });

  it('falls back to filename title when no slug in front matter', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-01-10-my-post.md`, '', '/:year/:slug/')
    ).toBe(`${BASE}/2024/my-post/`);
  });
});

describe('jekyllUrlForFile — date override from front matter', () => {
  it('uses date-only string from front matter literally (no UTC shift)', () => {
    const content = '---\ndate: "2020-06-15"\n---\n';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2020-01-01-post.md`, content, 'date')
    ).toBe(`${BASE}/2020/06/15/post.html`);
  });

  it('uses Date object parsed by YAML from front matter', () => {
    // When YAML auto-parses a date, it comes as a Date object interpreted in local time
    const content = '---\ndate: 2022-11-20\n---\n';
    const result = jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2022-01-01-post.md`, content, 'date');
    // The parsed date should override the filename date
    expect(result).toContain('/2022/');
    expect(result).toContain('/post.html');
  });

  it('handles category as singular string', () => {
    const content = '---\ncategory: devops\n---\n';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-01-10-post.md`, content, 'date')
    ).toBe(`${BASE}/devops/2024/01/10/post.html`);
  });

  it('handles space-separated categories string', () => {
    const content = '---\ncategories: tech tutorials\n---\n';
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/2024-01-10-post.md`, content, 'date')
    ).toBe(`${BASE}/tech/tutorials/2024/01/10/post.html`);
  });
});

describe('jekyllUrlForFile — custom template with i_month and i_day', () => {
  it('renders integer month and day without zero-padding', () => {
    expect(
      jekyllUrlForFile(
        BASE,
        REPO,
        `${REPO}/_posts/2024-03-05-post.md`,
        '',
        '/:year/:i_month/:i_day/:title/'
      )
    ).toBe(`${BASE}/2024/3/5/post/`);
  });
});

describe('jekyllUrlForFile — malformed post filename', () => {
  it('returns baseUrl for post file without date prefix', () => {
    expect(
      jekyllUrlForFile(BASE, REPO, `${REPO}/_posts/no-date-here.md`)
    ).toBe(BASE);
  });
});
