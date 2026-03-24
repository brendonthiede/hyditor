import { describe, it, expect } from 'vitest';
import {
  applyPlaceholders,
  extractPlaceholderKeys,
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
