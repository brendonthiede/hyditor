import { describe, it, expect } from 'vitest';
import {
  applyPlaceholders,
  extractPlaceholderKeys,
  extractPostMetadata,
  BUILT_IN_TEMPLATES,
  getAllTemplates,
  createPromptVersion,
  getOriginalBuiltInTemplate,
  isBuiltInOverridden,
  type ChatTemplate,
  type BuiltInOverride,
  type PromptVersion,
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

  it('applies built-in overrides when provided', () => {
    const overrides: BuiltInOverride[] = [{
      id: 'builtin-new-post',
      prompt: 'Overridden prompt',
      placeholders: [{ key: 'x', label: 'X' }],
      versions: [],
    }];
    const all = getAllTemplates([], overrides);
    const newPost = all.find((t) => t.id === 'builtin-new-post');
    expect(newPost).toBeDefined();
    expect(newPost!.prompt).toBe('Overridden prompt');
    expect(newPost!.placeholders).toEqual([{ key: 'x', label: 'X' }]);
    expect(newPost!.builtIn).toBe(true);
  });

  it('leaves non-overridden built-ins unchanged', () => {
    const overrides: BuiltInOverride[] = [{
      id: 'builtin-new-post',
      prompt: 'Overridden',
      placeholders: [],
      versions: [],
    }];
    const all = getAllTemplates([], overrides);
    const modifyMenu = all.find((t) => t.id === 'builtin-modify-menu');
    expect(modifyMenu).toBeDefined();
    expect(modifyMenu!.prompt).toBe(BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin-modify-menu')!.prompt);
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

describe('createPromptVersion', () => {
  it('creates version 1 when no existing versions', () => {
    const v = createPromptVersion('prompt', [{ key: 'a', label: 'A' }], []);
    expect(v.version).toBe(1);
    expect(v.prompt).toBe('prompt');
    expect(v.placeholders).toEqual([{ key: 'a', label: 'A' }]);
    expect(v.createdAt).toBeGreaterThan(0);
  });

  it('increments version based on existing max', () => {
    const existing: PromptVersion[] = [
      { version: 3, prompt: 'v3', placeholders: [], createdAt: 100 },
      { version: 1, prompt: 'v1', placeholders: [], createdAt: 50 },
    ];
    const v = createPromptVersion('v4', [], existing, 'AI improvement');
    expect(v.version).toBe(4);
    expect(v.changeNote).toBe('AI improvement');
  });
});

describe('getOriginalBuiltInTemplate', () => {
  it('returns the original built-in template by ID', () => {
    const t = getOriginalBuiltInTemplate('builtin-new-post');
    expect(t).toBeDefined();
    expect(t!.name).toBe('New Post');
    expect(t!.builtIn).toBe(true);
  });

  it('returns undefined for non-existent ID', () => {
    expect(getOriginalBuiltInTemplate('custom-xyz')).toBeUndefined();
  });
});

describe('isBuiltInOverridden', () => {
  it('returns true when override exists', () => {
    const overrides: BuiltInOverride[] = [{
      id: 'builtin-new-post',
      prompt: 'x',
      placeholders: [],
      versions: [],
    }];
    expect(isBuiltInOverridden('builtin-new-post', overrides)).toBe(true);
  });

  it('returns false when no override exists', () => {
    expect(isBuiltInOverridden('builtin-new-post', [])).toBe(false);
  });
});
