import { describe, it, expect } from 'vitest';
import {
  applyPlaceholders,
  extractPlaceholderKeys,
  extractPostMetadata,
  BUILT_IN_TEMPLATES,
  getAllTemplates,
  type ChatTemplate,
} from './aiTemplates';

describe('applyPlaceholders', () => {
  it('replaces named placeholders with values', () => {
    expect(applyPlaceholders('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
  });

  it('replaces multiple distinct placeholders', () => {
    const result = applyPlaceholders('{{a}} and {{b}}', { a: '1', b: '2' });
    expect(result).toBe('1 and 2');
  });

  it('replaces repeated placeholders', () => {
    expect(applyPlaceholders('{{x}} {{x}}', { x: 'hi' })).toBe('hi hi');
  });

  it('replaces missing keys with empty string', () => {
    expect(applyPlaceholders('Hello {{missing}}!', {})).toBe('Hello !');
  });

  it('returns original text when no placeholders exist', () => {
    expect(applyPlaceholders('no placeholders', { a: '1' })).toBe('no placeholders');
  });
});

describe('extractPlaceholderKeys', () => {
  it('extracts unique keys in order', () => {
    expect(extractPlaceholderKeys('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  it('returns empty array for no placeholders', () => {
    expect(extractPlaceholderKeys('no placeholder here')).toEqual([]);
  });

  it('handles adjacent placeholders', () => {
    expect(extractPlaceholderKeys('{{x}}{{y}}')).toEqual(['x', 'y']);
  });
});

describe('BUILT_IN_TEMPLATES', () => {
  it('has at least 4 built-in templates', () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it('all built-in templates are marked builtIn', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      expect(t.builtIn).toBe(true);
    }
  });

  it('all built-in template ids are unique', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all placeholders in prompt are declared', () => {
    for (const t of BUILT_IN_TEMPLATES) {
      const keys = extractPlaceholderKeys(t.prompt);
      const declared = t.placeholders.map((p) => p.key);
      for (const k of keys) {
        expect(declared).toContain(k);
      }
    }
  });
});

describe('getAllTemplates', () => {
  it('merges built-in and custom templates', () => {
    const custom: ChatTemplate = {
      id: 'custom-1',
      name: 'Custom',
      description: 'desc',
      prompt: '{{x}}',
      placeholders: [{ key: 'x', label: 'X' }],
      builtIn: false,
    };
    const all = getAllTemplates([custom]);
    expect(all.length).toBe(BUILT_IN_TEMPLATES.length + 1);
    expect(all[all.length - 1]).toBe(custom);
  });
});

describe('extractPostMetadata', () => {
  it('returns empty arrays for empty input', () => {
    expect(extractPostMetadata([])).toEqual({ categories: [], tags: [] });
  });

  it('extracts categories and tags from YAML arrays', () => {
    const post = `---
title: Test Post
categories: [tech, blog]
tags: [javascript, svelte]
---
Body text`;
    const result = extractPostMetadata([post]);
    expect(result.categories).toEqual(['blog', 'tech']);
    expect(result.tags).toEqual(['javascript', 'svelte']);
  });

  it('extracts from comma-separated strings', () => {
    const post = `---
title: Test
categories: "tech, blog"
tags: "javascript, svelte"
---
Body`;
    const result = extractPostMetadata([post]);
    expect(result.categories).toEqual(['blog', 'tech']);
    expect(result.tags).toEqual(['javascript', 'svelte']);
  });

  it('handles singular category/tag keys', () => {
    const post = `---
title: Test
category: tech
tag: javascript
---
Body`;
    const result = extractPostMetadata([post]);
    expect(result.categories).toEqual(['tech']);
    expect(result.tags).toEqual(['javascript']);
  });

  it('deduplicates across multiple posts', () => {
    const post1 = `---
categories: [tech]
tags: [javascript]
---`;
    const post2 = `---
categories: [tech, updates]
tags: [javascript, rust]
---`;
    const result = extractPostMetadata([post1, post2]);
    expect(result.categories).toEqual(['tech', 'updates']);
    expect(result.tags).toEqual(['javascript', 'rust']);
  });

  it('returns sorted results', () => {
    const post = `---
categories: [zebra, alpha, middle]
tags: [zsh, awk, make]
---`;
    const result = extractPostMetadata([post]);
    expect(result.categories).toEqual(['alpha', 'middle', 'zebra']);
    expect(result.tags).toEqual(['awk', 'make', 'zsh']);
  });

  it('handles posts with no frontmatter', () => {
    const result = extractPostMetadata(['Just plain text with no frontmatter']);
    expect(result.categories).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('handles posts with frontmatter but no categories or tags', () => {
    const post = `---
title: Test
layout: post
---
Body`;
    const result = extractPostMetadata([post]);
    expect(result.categories).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('skips empty and null values in arrays', () => {
    const post = `---
categories:
  - tech
  - null
  - blog
tags:
  - ""
  - valid
---`;
    const result = extractPostMetadata([post]);
    expect(result.categories).toEqual(['blog', 'tech']);
    expect(result.tags).toEqual(['valid']);
  });
});
