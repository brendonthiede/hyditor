import { describe, it, expect } from 'vitest';
import { parseFileEdits, parseMessageSegments } from './aiEdits';

describe('parseFileEdits', () => {
  it('returns empty array for text with no file blocks', () => {
    expect(parseFileEdits('Hello, this is a plain response.')).toEqual([]);
  });

  it('returns empty for regular code blocks without file: prefix', () => {
    const text = '```javascript\nconsole.log("hi");\n```';
    expect(parseFileEdits(text)).toEqual([]);
  });

  it('parses a single file edit block', () => {
    const text = 'Here is the change:\n\n```file:index.md\n# Hello World\n\nSome content.\n```\n\nDone!';
    const edits = parseFileEdits(text);
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('index.md');
    expect(edits[0].content).toBe('# Hello World\n\nSome content.');
  });

  it('parses multiple file edit blocks', () => {
    const text = [
      'Updating two files:',
      '',
      '```file:_config.yml',
      'title: My Site',
      'description: Cool site',
      '```',
      '',
      '```file:_posts/2024-01-01-hello.md',
      '---',
      'title: Hello',
      '---',
      'Welcome!',
      '```',
      '',
      'All done.',
    ].join('\n');

    const edits = parseFileEdits(text);
    expect(edits).toHaveLength(2);
    expect(edits[0].filePath).toBe('_config.yml');
    expect(edits[0].content).toBe('title: My Site\ndescription: Cool site');
    expect(edits[1].filePath).toBe('_posts/2024-01-01-hello.md');
    expect(edits[1].content).toBe('---\ntitle: Hello\n---\nWelcome!');
  });

  it('handles file path with spaces', () => {
    const text = '```file:assets/my file.css\nbody { color: red; }\n```';
    const edits = parseFileEdits(text);
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('assets/my file.css');
  });

  it('handles empty file content', () => {
    const text = '```file:empty.txt\n```';
    const edits = parseFileEdits(text);
    expect(edits).toHaveLength(1);
    expect(edits[0].filePath).toBe('empty.txt');
    expect(edits[0].content).toBe('');
  });
});

describe('parseMessageSegments', () => {
  it('returns single text segment for plain messages', () => {
    const segments = parseMessageSegments('Just some text.');
    expect(segments).toEqual([{ type: 'text', content: 'Just some text.' }]);
  });

  it('splits text and file edits correctly', () => {
    const text = 'Before\n\n```file:test.md\n# Test\n```\n\nAfter';
    const segments = parseMessageSegments(text);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ type: 'text', content: 'Before\n\n' });
    expect(segments[1].type).toBe('fileEdit');
    if (segments[1].type === 'fileEdit') {
      expect(segments[1].edit.filePath).toBe('test.md');
    }
    expect(segments[2]).toEqual({ type: 'text', content: '\n\nAfter' });
  });

  it('handles message starting with a file edit', () => {
    const text = '```file:start.md\ncontent\n```\nExplanation';
    const segments = parseMessageSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[0].type).toBe('fileEdit');
    expect(segments[1]).toEqual({ type: 'text', content: '\nExplanation' });
  });

  it('handles message ending with a file edit', () => {
    const text = 'Here:\n```file:end.md\ncontent\n```';
    const segments = parseMessageSegments(text);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ type: 'text', content: 'Here:\n' });
    expect(segments[1].type).toBe('fileEdit');
  });
});
