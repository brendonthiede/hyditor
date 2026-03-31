import { describe, it, expect } from 'vitest';
import {
  computeTranscriptEntries,
  computeTemplateStats,
  type TranscriptSession,
  type TemplateUsage,
} from './aiTranscripts';

function makeSession(
  overrides: Partial<TranscriptSession> & { id: string },
): TranscriptSession {
  return {
    title: 'Test session',
    messages: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeUsage(overrides: Partial<TemplateUsage> = {}): TemplateUsage {
  return {
    templateId: 'builtin-new-post',
    templateName: 'New Post',
    placeholderValues: { title: 'Hello' },
    promptText: 'Create a new post titled Hello',
    messageIndex: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('computeTranscriptEntries', () => {
  it('returns empty array for sessions without template usages', () => {
    const sessions = [
      makeSession({ id: '1', messages: [{ role: 'user', content: 'hi' }] }),
    ];
    expect(computeTranscriptEntries(sessions)).toEqual([]);
  });

  it('returns empty array for empty sessions list', () => {
    expect(computeTranscriptEntries([])).toEqual([]);
  });

  it('computes zero follow-ups when only the template prompt was sent', () => {
    const sessions = [
      makeSession({
        id: '1',
        messages: [
          { role: 'user', content: 'Create a post' },
          { role: 'model', content: 'Here is your post' },
        ],
        templateUsages: [makeUsage({ messageIndex: 0, timestamp: 1000 })],
      }),
    ];

    const entries = computeTranscriptEntries(sessions);
    expect(entries).toHaveLength(1);
    expect(entries[0].followUpCount).toBe(0);
    expect(entries[0].totalExchanges).toBe(2);
    expect(entries[0].templateId).toBe('builtin-new-post');
    expect(entries[0].sessionId).toBe('1');
  });

  it('counts follow-up user messages after the template prompt', () => {
    const sessions = [
      makeSession({
        id: '1',
        messages: [
          { role: 'user', content: 'Create a post' },
          { role: 'model', content: 'Here is your post' },
          { role: 'user', content: 'Make the title shorter' },
          { role: 'model', content: 'Updated post' },
          { role: 'user', content: 'Add tags' },
          { role: 'model', content: 'Done' },
        ],
        templateUsages: [makeUsage({ messageIndex: 0, timestamp: 1000 })],
      }),
    ];

    const entries = computeTranscriptEntries(sessions);
    expect(entries).toHaveLength(1);
    expect(entries[0].followUpCount).toBe(2);
    expect(entries[0].totalExchanges).toBe(6);
  });

  it('handles multiple template usages in a single session', () => {
    const sessions = [
      makeSession({
        id: '1',
        messages: [
          { role: 'user', content: 'Create a post' },
          { role: 'model', content: 'Post created' },
          { role: 'user', content: 'Fix the title' },
          { role: 'model', content: 'Fixed' },
          { role: 'user', content: 'Modify menu' },
          { role: 'model', content: 'Menu updated' },
        ],
        templateUsages: [
          makeUsage({ messageIndex: 0, timestamp: 1000 }),
          makeUsage({
            templateId: 'builtin-modify-menu',
            templateName: 'Modify Menu',
            messageIndex: 4,
            timestamp: 2000,
          }),
        ],
      }),
    ];

    const entries = computeTranscriptEntries(sessions);
    expect(entries).toHaveLength(2);

    // Newest first
    const menuEntry = entries.find((e) => e.templateId === 'builtin-modify-menu')!;
    const postEntry = entries.find((e) => e.templateId === 'builtin-new-post')!;

    expect(postEntry.followUpCount).toBe(1); // one follow-up before next template
    expect(postEntry.totalExchanges).toBe(4); // messages 0-3
    expect(menuEntry.followUpCount).toBe(0);
    expect(menuEntry.totalExchanges).toBe(2); // messages 4-5
  });

  it('sorts entries newest first', () => {
    const sessions = [
      makeSession({
        id: '1',
        messages: [
          { role: 'user', content: 'a' },
          { role: 'model', content: 'b' },
        ],
        templateUsages: [makeUsage({ messageIndex: 0, timestamp: 1000 })],
      }),
      makeSession({
        id: '2',
        messages: [
          { role: 'user', content: 'c' },
          { role: 'model', content: 'd' },
        ],
        templateUsages: [makeUsage({ messageIndex: 0, timestamp: 3000 })],
      }),
    ];

    const entries = computeTranscriptEntries(sessions);
    expect(entries[0].sessionId).toBe('2');
    expect(entries[1].sessionId).toBe('1');
  });

  it('preserves placeholder values in entries', () => {
    const sessions = [
      makeSession({
        id: '1',
        messages: [
          { role: 'user', content: 'test' },
          { role: 'model', content: 'reply' },
        ],
        templateUsages: [
          makeUsage({
            messageIndex: 0,
            placeholderValues: { title: 'My Post', tags: 'rust, wasm' },
          }),
        ],
      }),
    ];

    const entries = computeTranscriptEntries(sessions);
    expect(entries[0].placeholderValues).toEqual({ title: 'My Post', tags: 'rust, wasm' });
  });
});

describe('computeTemplateStats', () => {
  it('returns empty array for no entries', () => {
    expect(computeTemplateStats([])).toEqual([]);
  });

  it('aggregates stats for a single template', () => {
    const entries = [
      {
        sessionId: '1', sessionTitle: 'S1', templateId: 'builtin-new-post',
        templateName: 'New Post', placeholderValues: {}, promptText: 'p',
        followUpCount: 2, totalExchanges: 6, createdAt: 1000,
      },
      {
        sessionId: '2', sessionTitle: 'S2', templateId: 'builtin-new-post',
        templateName: 'New Post', placeholderValues: {}, promptText: 'p',
        followUpCount: 0, totalExchanges: 2, createdAt: 2000,
      },
      {
        sessionId: '3', sessionTitle: 'S3', templateId: 'builtin-new-post',
        templateName: 'New Post', placeholderValues: {}, promptText: 'p',
        followUpCount: 4, totalExchanges: 10, createdAt: 3000,
      },
    ];

    const stats = computeTemplateStats(entries);
    expect(stats).toHaveLength(1);
    expect(stats[0].templateId).toBe('builtin-new-post');
    expect(stats[0].usageCount).toBe(3);
    expect(stats[0].avgFollowUps).toBe(2);
    expect(stats[0].minFollowUps).toBe(0);
    expect(stats[0].maxFollowUps).toBe(4);
    expect(stats[0].entries).toHaveLength(3);
  });

  it('groups entries by template ID', () => {
    const entries = [
      {
        sessionId: '1', sessionTitle: 'S1', templateId: 'builtin-new-post',
        templateName: 'New Post', placeholderValues: {}, promptText: 'p',
        followUpCount: 1, totalExchanges: 4, createdAt: 1000,
      },
      {
        sessionId: '2', sessionTitle: 'S2', templateId: 'builtin-modify-menu',
        templateName: 'Modify Menu', placeholderValues: {}, promptText: 'p',
        followUpCount: 3, totalExchanges: 8, createdAt: 2000,
      },
    ];

    const stats = computeTemplateStats(entries);
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.templateId)).toContain('builtin-new-post');
    expect(stats.map((s) => s.templateId)).toContain('builtin-modify-menu');
  });

  it('sorts by most used first, then by highest avg follow-ups', () => {
    const entries = [
      {
        sessionId: '1', sessionTitle: 'S1', templateId: 'a',
        templateName: 'A', placeholderValues: {}, promptText: 'p',
        followUpCount: 5, totalExchanges: 12, createdAt: 1000,
      },
      {
        sessionId: '2', sessionTitle: 'S2', templateId: 'b',
        templateName: 'B', placeholderValues: {}, promptText: 'p',
        followUpCount: 0, totalExchanges: 2, createdAt: 2000,
      },
      {
        sessionId: '3', sessionTitle: 'S3', templateId: 'b',
        templateName: 'B', placeholderValues: {}, promptText: 'p',
        followUpCount: 1, totalExchanges: 4, createdAt: 3000,
      },
    ];

    const stats = computeTemplateStats(entries);
    // 'b' has 2 usages, 'a' has 1 — b first
    expect(stats[0].templateId).toBe('b');
    expect(stats[1].templateId).toBe('a');
  });
});
