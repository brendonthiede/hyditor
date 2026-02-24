const BASE_URL = 'http://127.0.0.1:4000';

/**
 * Derive the Jekyll preview URL for an absolute file path.
 *
 * Rules (matching Jekyll's default permalink style):
 *  - `_posts/YYYY-MM-DD-slug.md`  → `baseUrl/YYYY/MM/DD/slug/`
 *  - `_drafts/slug.md`            → `baseUrl/YYYY/MM/DD/slug/` (today's UTC date, requires --drafts)
 *  - Other `_*` directories       → `baseUrl` (internal / not served)
 *  - `index.md`                   → `baseUrl/`
 *  - `page.md`                    → `baseUrl/page/`
 *  - `sub/page.md`                → `baseUrl/sub/page/`
 *  - Non-Markdown file            → `baseUrl`
 */
export function jekyllUrlForFile(baseUrl: string, repoPath: string, filePath: string): string {
  if (!filePath.endsWith('.md')) {
    return baseUrl;
  }

  const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRepo = normalize(repoPath);
  const normalizedFile = normalize(filePath);

  if (!normalizedFile.startsWith(normalizedRepo + '/')) {
    return baseUrl;
  }

  const rel = normalizedFile.slice(normalizedRepo.length + 1);

  // _posts/YYYY-MM-DD-slug.md → /YYYY/MM/DD/slug/
  const postMatch = rel.match(/^_posts\/(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
  if (postMatch) {
    const [, year, month, day, slug] = postMatch;
    return `${baseUrl}/${year}/${month}/${day}/${slug}/`;
  }

  // _drafts/slug.md → /YYYY/MM/DD/slug/ (Jekyll uses today's date for drafts)
  const draftMatch = rel.match(/^_drafts\/(.+)\.md$/);
  if (draftMatch) {
    const slug = draftMatch[1];
    const today = new Date();
    const year = today.getUTCFullYear();
    const month = String(today.getUTCMonth() + 1).padStart(2, '0');
    const day = String(today.getUTCDate()).padStart(2, '0');
    return `${baseUrl}/${year}/${month}/${day}/${slug}/`;
  }

  // Other underscore directories (layouts, includes, data, etc.) are not served.
  if (rel.startsWith('_')) {
    return baseUrl;
  }

  // index.md → /
  if (rel === 'index.md') {
    return `${baseUrl}/`;
  }

  // Regular pages: strip .md, add trailing slash for pretty URLs.
  const urlPath = rel.replace(/\.md$/, '/');
  return `${baseUrl}/${urlPath}`;
}

export { BASE_URL as JEKYLL_BASE_URL };

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export function buildPostFilename(date: Date, title: string): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${slugify(title)}.md`;
}
