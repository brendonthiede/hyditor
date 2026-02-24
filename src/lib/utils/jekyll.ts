import { parse as parseYaml } from 'yaml';

const BASE_URL = 'http://127.0.0.1:4000';

// Jekyll's built-in named permalink presets.
const PERMALINK_PRESETS: Record<string, string> = {
  date: '/:categories/:year/:month/:day/:title:output_ext',
  pretty: '/:categories/:year/:month/:day/:title/',
  ordinal: '/:categories/:year/:y_day/:title:output_ext',
  none: '/:categories/:title:output_ext'
};

function resolvePermalinkTemplate(sitePermalink: string): string {
  return PERMALINK_PRESETS[sitePermalink] ?? sitePermalink;
}

function expandPermalinkTemplate(
  template: string,
  vars: {
    year: string;
    month: string;
    day: string;
    title: string;
    slug: string;
    categories: string[];
    outputExt: string;
  }
): string {
  const trailingSlash = template.endsWith('/') ? '/' : '';
  const segments = template.split('/').filter((s) => s.length > 0);
  const expanded: string[] = [];

  for (const segment of segments) {
    if (segment === ':categories') {
      // Drop segment entirely when there are no categories.
      if (vars.categories.length > 0) {
        expanded.push(...vars.categories);
      }
    } else {
      const s = segment
        .replace(':year', vars.year)
        .replace(':month', vars.month)
        .replace(':i_month', String(parseInt(vars.month, 10)))
        .replace(':day', vars.day)
        .replace(':i_day', String(parseInt(vars.day, 10)))
        .replace(':slug', vars.slug)
        .replace(':title', vars.title)
        .replace(':output_ext', vars.outputExt);
      expanded.push(s);
    }
  }

  return '/' + expanded.join('/') + trailingSlash;
}

function parseCategories(data: Record<string, unknown>): string[] {
  const raw = data['categories'] ?? data['category'];
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.trim().split(/\s+/).filter(Boolean);
  return [];
}

function parseFrontmatterData(fileContent: string): Record<string, unknown> {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return {};
  try {
    const parsed = parseYaml(match[1] ?? '');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

/**
 * Parse the `permalink` key from a Jekyll `_config.yml` content string.
 * Returns the raw value (preset name or custom template), defaulting to `'date'`.
 */
export function parseSitePermalink(configContent: string): string {
  try {
    const config = parseYaml(configContent);
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const p = (config as Record<string, unknown>)['permalink'];
      if (typeof p === 'string' && p.trim().length > 0) return p.trim();
    }
  } catch {
    // fall through
  }
  return 'date';
}

/**
 * Derive the Jekyll preview URL for a file, respecting the site permalink
 * template and the file's own front matter (permalink, categories, date, slug).
 *
 * @param baseUrl        Jekyll base URL, e.g. `http://127.0.0.1:4000`
 * @param repoPath       Absolute path to the repo root
 * @param filePath       Absolute path to the file
 * @param fileContent    Raw content of the file (used to read front matter)
 * @param sitePermalink  Value of `permalink` in `_config.yml`, or a preset
 *                       name (`date`, `pretty`, `ordinal`, `none`).
 *                       Defaults to `'date'`.
 */
export function jekyllUrlForFile(
  baseUrl: string,
  repoPath: string,
  filePath: string,
  fileContent: string = '',
  sitePermalink: string = 'date'
): string {
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

  // Files in non-served underscore directories.
  const underscore = rel.match(/^(_(?!posts|drafts)[^/]+)\//);
  if (underscore) {
    return baseUrl;
  }

  const fm = parseFrontmatterData(fileContent);

  // A `permalink` in front matter always wins — use it as-is.
  if (typeof fm['permalink'] === 'string' && fm['permalink'].trim().length > 0) {
    const p = fm['permalink'].trim();
    return `${baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
  }

  const isPost = rel.startsWith('_posts/');
  const isDraft = rel.startsWith('_drafts/');

  if (!isPost && !isDraft) {
    // Regular pages: not subject to the post permalink template.
    if (rel === 'index.md') return `${baseUrl}/`;
    const urlPath = rel.replace(/\.md$/, '/');
    return `${baseUrl}/${urlPath}`;
  }

  // Determine date and title-slug from filename.
  let year: string, month: string, day: string, titleSlug: string;

  if (isPost) {
    const postMatch = rel.match(/^_posts\/(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
    if (!postMatch) return baseUrl;
    [, year, month, day, titleSlug] = postMatch as [string, string, string, string, string];
  } else {
    // Draft: use today's local date (Jekyll uses local time)
    const today = new Date();
    year = String(today.getFullYear());
    month = String(today.getMonth() + 1).padStart(2, '0');
    day = String(today.getDate()).padStart(2, '0');
    const draftMatch = rel.match(/^_drafts\/(.+)\.md$/);
    if (!draftMatch) return baseUrl;
    // Strip an optional leading date prefix (YYYY-MM-DD-) so drafts named like
    // posts get the same slug treatment Jekyll applies.
    titleSlug = (draftMatch[1] as string).replace(/^\d{4}-\d{2}-\d{2}-/, '');
  }

  // Front matter can override date and slug.
  // Jekyll (Ruby) interprets dates in local time, so we must do the same.
  const rawDate = fm['date'];
  if (rawDate instanceof Date) {
    // YAML library already parsed the value as a Date object.
    year = String(rawDate.getFullYear());
    month = String(rawDate.getMonth() + 1).padStart(2, '0');
    day = String(rawDate.getDate()).padStart(2, '0');
  } else if (typeof rawDate === 'string') {
    if (/T|\d{2}:\d{2}/.test(rawDate)) {
      // Date+time string with optional timezone — parse and read in local time.
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        year = String(d.getFullYear());
        month = String(d.getMonth() + 1).padStart(2, '0');
        day = String(d.getDate()).padStart(2, '0');
      }
    } else {
      // Date-only string (YYYY-MM-DD): extract literally to avoid UTC-midnight shift.
      const dmatch = rawDate.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (dmatch) {
        [, year, month, day] = dmatch as [string, string, string, string];
      }
    }
  }
  const slug = typeof fm['slug'] === 'string' ? fm['slug'] : titleSlug;

  const categories = parseCategories(fm);
  const template = resolvePermalinkTemplate(sitePermalink);
  const path = expandPermalinkTemplate(template, {
    year,
    month,
    day,
    title: titleSlug,
    slug,
    categories,
    outputExt: '.html'
  });

  return `${baseUrl}${path}`;
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
