/** AI chat prompt templates for common Jekyll tasks. */

import { parseFrontmatter } from './frontmatter';

export interface TemplatePlaceholder {
  key: string;
  label: string;
  default?: string;
}

/** A single versioned snapshot of a template's prompt and placeholders. */
export interface PromptVersion {
  version: number;
  prompt: string;
  placeholders: TemplatePlaceholder[];
  createdAt: number;
  /** Optional note describing what changed in this version. */
  changeNote?: string;
}

export interface ChatTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  placeholders: TemplatePlaceholder[];
  builtIn: boolean;
  /** Version history (newest first). The current prompt is always versions[0]. */
  versions?: PromptVersion[];
}

const TEMPLATES_STORAGE_KEY = 'hyditor-ai-templates';
const OVERRIDES_STORAGE_KEY = 'hyditor-ai-template-overrides';

/** Replace `{{key}}` placeholders in a prompt with the provided values. */
export function applyPlaceholders(
  prompt: string,
  values: Record<string, string>,
): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return values[key] ?? '';
  });
}

/** Extract placeholder keys referenced in a prompt string. */
export function extractPlaceholderKeys(prompt: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      keys.push(m[1]);
    }
  }
  return keys;
}

export const BUILT_IN_TEMPLATES: ChatTemplate[] = [
  {
    id: 'builtin-new-post',
    name: 'New Post',
    description: 'Generate a new Jekyll blog post with front matter',
    prompt: `Create a new Jekyll blog post with the following details:
- Title: {{title}}
- Categories: {{categories}}
- Tags: {{tags}}
- Date: {{date}}

Generate the complete file with proper YAML front matter (layout: post, title, date, categories, tags) and a starter body. Use the Jekyll filename convention (_posts/YYYY-MM-DD-slug.md).

<!-- Replace this with your ideas for the post, or remove it to start with a blank post. -->`,
    placeholders: [
      { key: 'title', label: 'Post title' },
      { key: 'categories', label: 'Categories (comma-separated)', default: '' },
      { key: 'tags', label: 'Tags (comma-separated)', default: '' },
      { key: 'date', label: 'Date (YYYY-MM-DD)', default: new Date().toISOString().slice(0, 10) },
    ],
    builtIn: true,
  },
  {
    id: 'builtin-modify-menu',
    name: 'Modify Menu',
    description: 'Edit site navigation or menu configuration',
    prompt: `I want to modify the site navigation/menu. Here's what I need:
{{description}}

Please find the relevant navigation configuration file (likely _data/navigation.yml, _config.yml, or an _includes/ partial) and update it accordingly. Show the complete updated file.`,
    placeholders: [
      { key: 'description', label: 'Describe the menu changes' },
    ],
    builtIn: true,
  },
  {
    id: 'builtin-featured-link',
    name: 'Change Featured Link',
    description: 'Update the featured post or link on the home page',
    prompt: `I want to change the featured content on the home page.
{{description}}

Find the relevant template or configuration (e.g., index.md, index.html, _layouts/home.html, or _config.yml) and update the featured link/post. Show the complete updated file.`,
    placeholders: [
      { key: 'description', label: 'Describe the new featured content' },
    ],
    builtIn: true,
  },
  {
    id: 'builtin-color-styling',
    name: 'Modify Colors',
    description: 'Adjust site color theme and styling',
    prompt: `I want to modify the color styling of the site.
{{description}}

Find the relevant CSS/SCSS file or _config.yml theme settings and make the changes. Show the complete updated file(s).`,
    placeholders: [
      { key: 'description', label: 'Describe the color changes' },
    ],
    builtIn: true,
  },
];

export function loadCustomTemplates(): ChatTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatTemplate[];
  } catch {
    return [];
  }
}

export function persistCustomTemplates(templates: ChatTemplate[]): void {
  localStorage.setItem(
    TEMPLATES_STORAGE_KEY,
    JSON.stringify(templates.filter((t) => !t.builtIn)),
  );
}

/**
 * User overrides for built-in templates. Stored separately so the originals
 * are always recoverable via "Reset to default".
 */
export interface BuiltInOverride {
  id: string;
  prompt: string;
  placeholders: TemplatePlaceholder[];
  versions: PromptVersion[];
}

export function loadBuiltInOverrides(): BuiltInOverride[] {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BuiltInOverride[];
  } catch {
    return [];
  }
}

export function persistBuiltInOverrides(overrides: BuiltInOverride[]): void {
  localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
}

/**
 * Merge built-in templates with user overrides and custom templates.
 * Overrides replace built-in prompt/placeholders while keeping builtIn: true.
 */
export function getAllTemplates(
  customTemplates: ChatTemplate[],
  overrides: BuiltInOverride[] = [],
): ChatTemplate[] {
  const overrideMap = new Map(overrides.map((o) => [o.id, o]));
  const merged = BUILT_IN_TEMPLATES.map((t) => {
    const override = overrideMap.get(t.id);
    if (override) {
      return {
        ...t,
        prompt: override.prompt,
        placeholders: override.placeholders,
        versions: override.versions,
      };
    }
    return t;
  });
  return [...merged, ...customTemplates];
}

/**
 * Create a new PromptVersion entry from a prompt and placeholders.
 * Automatically assigns the next version number based on existing history.
 */
export function createPromptVersion(
  prompt: string,
  placeholders: TemplatePlaceholder[],
  existingVersions: PromptVersion[],
  changeNote?: string,
): PromptVersion {
  const nextVersion = existingVersions.length > 0
    ? Math.max(...existingVersions.map((v) => v.version)) + 1
    : 1;
  return {
    version: nextVersion,
    prompt,
    placeholders: [...placeholders],
    createdAt: Date.now(),
    changeNote,
  };
}

/**
 * Get the original (unmodified) built-in template by ID.
 * Returns undefined if not a built-in template.
 */
export function getOriginalBuiltInTemplate(id: string): ChatTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id);
}

/**
 * Check if a built-in template has been overridden by the user.
 */
export function isBuiltInOverridden(id: string, overrides: BuiltInOverride[]): boolean {
  return overrides.some((o) => o.id === id);
}

/**
 * Extract unique categories and tags from an array of post file contents.
 * Handles both YAML array (`tags: [a, b]`) and string (`tags: "a, b"`) formats.
 */
export function extractPostMetadata(postContents: string[]): {
  categories: string[];
  tags: string[];
} {
  const categorySet = new Set<string>();
  const tagSet = new Set<string>();

  for (const content of postContents) {
    const { data } = parseFrontmatter(content);
    collectValues(data['categories'] ?? data['category'], categorySet);
    collectValues(data['tags'] ?? data['tag'], tagSet);
  }

  return {
    categories: [...categorySet].sort((a, b) => a.localeCompare(b)),
    tags: [...tagSet].sort((a, b) => a.localeCompare(b)),
  };
}

function collectValues(value: unknown, target: Set<string>): void {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (v == null) continue;
      const s = String(v).trim();
      if (s) target.add(s);
    }
  } else if (typeof value === 'string') {
    for (const part of value.split(',')) {
      const s = part.trim();
      if (s) target.add(s);
    }
  } else {
    const s = String(value).trim();
    if (s) target.add(s);
  }
}
