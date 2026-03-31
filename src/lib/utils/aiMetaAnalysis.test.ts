import { describe, it, expect } from 'vitest';
import {
  buildAnalysisPrompt,
  parseAnalysisResponse,
} from './aiMetaAnalysis';
import type { ChatTemplate } from './aiTemplates';
import type { TranscriptEntry } from './aiTranscripts';

function makeTemplate(overrides: Partial<ChatTemplate> = {}): ChatTemplate {
  return {
    id: 'builtin-new-post',
    name: 'New Post',
    description: 'Generate a new Jekyll blog post',
    prompt: 'Create a post titled {{title}}',
    placeholders: [{ key: 'title', label: 'Post title' }],
    builtIn: true,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TranscriptEntry> = {}): TranscriptEntry {
  return {
    sessionId: '1',
    sessionTitle: 'Test',
    templateId: 'builtin-new-post',
    templateName: 'New Post',
    placeholderValues: { title: 'Hello' },
    promptText: 'Create a post titled Hello',
    followUpCount: 2,
    totalExchanges: 6,
    createdAt: 1000,
    ...overrides,
  };
}

describe('buildAnalysisPrompt', () => {
  it('includes template name and current prompt', () => {
    const template = makeTemplate();
    const entries = [makeEntry()];
    const result = buildAnalysisPrompt(template, entries, []);
    expect(result).toContain('New Post');
    expect(result).toContain('Create a post titled {{title}}');
  });

  it('includes usage statistics', () => {
    const template = makeTemplate();
    const entries = [
      makeEntry({ followUpCount: 0 }),
      makeEntry({ followUpCount: 4 }),
    ];
    const result = buildAnalysisPrompt(template, entries, []);
    expect(result).toContain('Total uses: 2');
    expect(result).toContain('Average follow-ups per use: 2.0');
    expect(result).toContain('Min follow-ups: 0');
    expect(result).toContain('Max follow-ups: 4');
  });

  it('includes sample conversations when provided', () => {
    const template = makeTemplate();
    const entries = [makeEntry()];
    const transcripts = [{
      entry: entries[0],
      messages: [
        { role: 'user' as const, content: 'Create a post titled Hello' },
        { role: 'model' as const, content: 'Here is your post' },
        { role: 'user' as const, content: 'Add more tags' },
        { role: 'model' as const, content: 'Updated with tags' },
      ],
    }];
    const result = buildAnalysisPrompt(template, entries, transcripts);
    expect(result).toContain('Conversation 1 (2 follow-ups)');
    expect(result).toContain('Add more tags');
    expect(result).toContain('title="Hello"');
  });

  it('includes original template when overridden', () => {
    const template = makeTemplate({ prompt: 'Modified prompt {{title}}' });
    const original = makeTemplate();
    const entries = [makeEntry()];
    const result = buildAnalysisPrompt(template, entries, [], original);
    expect(result).toContain('Original Built-in Template');
    expect(result).toContain('Create a post titled {{title}}');
  });

  it('omits original section when prompts match', () => {
    const template = makeTemplate();
    const original = makeTemplate();
    const entries = [makeEntry()];
    const result = buildAnalysisPrompt(template, entries, [], original);
    expect(result).not.toContain('Original Built-in Template');
  });

  it('truncates long assistant responses', () => {
    const template = makeTemplate();
    const entries = [makeEntry({ followUpCount: 0 })];
    const longContent = 'x'.repeat(600);
    const transcripts = [{
      entry: entries[0],
      messages: [
        { role: 'user' as const, content: 'test' },
        { role: 'model' as const, content: longContent },
      ],
    }];
    const result = buildAnalysisPrompt(template, entries, transcripts);
    expect(result).toContain('[... truncated for analysis ...]');
    expect(result).not.toContain(longContent);
  });

  it('limits to 5 sample conversations', () => {
    const template = makeTemplate();
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry({ sessionId: String(i), createdAt: i * 1000 }),
    );
    const transcripts = entries.map((entry) => ({
      entry,
      messages: [{ role: 'user' as const, content: 'test' }],
    }));
    const result = buildAnalysisPrompt(template, entries, transcripts);
    const matches = result.match(/### Conversation \d+/g);
    expect(matches).toHaveLength(5);
  });

  it('includes placeholder labels in output', () => {
    const template = makeTemplate({
      placeholders: [
        { key: 'title', label: 'Post title' },
        { key: 'tags', label: 'Tags (comma-separated)' },
      ],
    });
    const entries = [makeEntry()];
    const result = buildAnalysisPrompt(template, entries, []);
    expect(result).toContain('{{title}} (Post title)');
    expect(result).toContain('{{tags}} (Tags (comma-separated))');
  });

  it('requests improved-prompt and improved-placeholders blocks', () => {
    const template = makeTemplate();
    const entries = [makeEntry()];
    const result = buildAnalysisPrompt(template, entries, []);
    expect(result).toContain('```improved-prompt');
    expect(result).toContain('```improved-placeholders');
  });
});

describe('parseAnalysisResponse', () => {
  it('extracts improved prompt from tagged code block', () => {
    const response = `Some analysis text.

\`\`\`improved-prompt
Create a post titled {{title}} with tags {{tags}}
Include a brief outline: {{outline}}
\`\`\`

More text.`;
    const result = parseAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.improvedPrompt).toContain('Create a post titled {{title}}');
    expect(result!.improvedPrompt).toContain('Include a brief outline: {{outline}}');
  });

  it('extracts explicit placeholders from tagged block', () => {
    const response = `Text.

\`\`\`improved-prompt
{{title}} {{tags}}
\`\`\`

\`\`\`improved-placeholders
title: Post title
tags: Tags (comma-separated)
outline: Brief outline of the post
\`\`\``;
    const result = parseAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.placeholders).toEqual([
      { key: 'title', label: 'Post title' },
      { key: 'tags', label: 'Tags (comma-separated)' },
      { key: 'outline', label: 'Brief outline of the post' },
    ]);
  });

  it('falls back to extracting placeholders from prompt when no block', () => {
    const response = `Text.

\`\`\`improved-prompt
Create {{title}} with {{tags}} and {{category}}
\`\`\``;
    const result = parseAnalysisResponse(response);
    expect(result).not.toBeNull();
    expect(result!.placeholders).toHaveLength(3);
    expect(result!.placeholders[0]).toEqual({ key: 'title', label: 'Title' });
    expect(result!.placeholders[1]).toEqual({ key: 'tags', label: 'Tags' });
    expect(result!.placeholders[2]).toEqual({ key: 'category', label: 'Category' });
  });

  it('returns null when no improved-prompt block exists', () => {
    const response = 'Just some analysis without a code block.';
    expect(parseAnalysisResponse(response)).toBeNull();
  });

  it('deduplicates placeholders extracted from prompt', () => {
    const response = `\`\`\`improved-prompt
{{title}} and {{title}} again
\`\`\``;
    const result = parseAnalysisResponse(response);
    expect(result!.placeholders).toHaveLength(1);
  });

  it('handles underscore placeholder keys', () => {
    const response = `\`\`\`improved-prompt
{{post_title}} and {{tag_list}}
\`\`\``;
    const result = parseAnalysisResponse(response);
    expect(result!.placeholders).toEqual([
      { key: 'post_title', label: 'Post title' },
      { key: 'tag_list', label: 'Tag list' },
    ]);
  });
});
