/** AI chat prompt templates for common Jekyll tasks. */

export interface TemplatePlaceholder {
  key: string;
  label: string;
  default?: string;
}

export interface ChatTemplate {
  id: string;
  name: string;
  description: string;
  prompt: string;
  placeholders: TemplatePlaceholder[];
  builtIn: boolean;
}

const TEMPLATES_STORAGE_KEY = 'hyditor-ai-templates';

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

Generate the complete file with proper YAML front matter (layout: post, title, date, categories, tags) and a starter body. Use the Jekyll filename convention (_posts/YYYY-MM-DD-slug.md).`,
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

export function getAllTemplates(customTemplates: ChatTemplate[]): ChatTemplate[] {
  return [...BUILT_IN_TEMPLATES, ...customTemplates];
}
