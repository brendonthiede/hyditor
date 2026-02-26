import { describe, expect, it } from 'vitest';
import { getErrorMessage, isMarkdownPath, joinRepoPath, toErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('extracts message from an Error instance', () => {
    expect(getErrorMessage(new Error('something broke'))).toBe('something broke');
  });

  it('returns a bare string as-is', () => {
    expect(getErrorMessage('network timeout')).toBe('network timeout');
  });

  it('extracts message from a plain object with message property', () => {
    expect(getErrorMessage({ message: 'object error' })).toBe('object error');
  });

  it('returns null for an Error with empty message', () => {
    expect(getErrorMessage(new Error(''))).toBeNull();
  });

  it('returns null for a whitespace-only string', () => {
    expect(getErrorMessage('   ')).toBeNull();
  });

  it('returns null for null', () => {
    expect(getErrorMessage(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(getErrorMessage(undefined)).toBeNull();
  });

  it('returns null for a number', () => {
    expect(getErrorMessage(42)).toBeNull();
  });

  it('returns null for object with non-string message', () => {
    expect(getErrorMessage({ message: 123 })).toBeNull();
  });

  it('returns null for object with empty string message', () => {
    expect(getErrorMessage({ message: '' })).toBeNull();
  });
});

describe('toErrorMessage', () => {
  it('returns the error message when available', () => {
    expect(toErrorMessage(new Error('oops'), 'fallback')).toBe('oops');
  });

  it('returns the fallback when no message is available', () => {
    expect(toErrorMessage(null, 'fallback text')).toBe('fallback text');
  });

  it('returns the fallback for undefined', () => {
    expect(toErrorMessage(undefined, 'default')).toBe('default');
  });

  it('returns the fallback for empty-message Error', () => {
    expect(toErrorMessage(new Error(''), 'default')).toBe('default');
  });
});

describe('isMarkdownPath', () => {
  it('returns true for .md files', () => {
    expect(isMarkdownPath('post.md')).toBe(true);
    expect(isMarkdownPath('_posts/2024-01-01-hello.md')).toBe(true);
  });

  it('returns true for .markdown files', () => {
    expect(isMarkdownPath('post.markdown')).toBe(true);
    expect(isMarkdownPath('_drafts/draft.markdown')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMarkdownPath('README.MD')).toBe(true);
    expect(isMarkdownPath('doc.MARKDOWN')).toBe(true);
    expect(isMarkdownPath('file.Md')).toBe(true);
  });

  it('returns false for non-markdown files', () => {
    expect(isMarkdownPath('style.css')).toBe(false);
    expect(isMarkdownPath('script.js')).toBe(false);
    expect(isMarkdownPath('image.png')).toBe(false);
    expect(isMarkdownPath('data.json')).toBe(false);
  });

  it('returns false for files with md in the name but wrong extension', () => {
    expect(isMarkdownPath('markdown-notes.txt')).toBe(false);
    expect(isMarkdownPath('readme.md.bak')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMarkdownPath('')).toBe(false);
  });
});

describe('joinRepoPath', () => {
  it('joins a base path and relative path', () => {
    expect(joinRepoPath('/home/user/repo', 'src/file.ts')).toBe('/home/user/repo/src/file.ts');
  });

  it('strips trailing slashes from base path', () => {
    expect(joinRepoPath('/home/user/repo/', 'file.ts')).toBe('/home/user/repo/file.ts');
    expect(joinRepoPath('/home/user/repo///', 'file.ts')).toBe('/home/user/repo/file.ts');
  });

  it('strips leading slashes from relative path', () => {
    expect(joinRepoPath('/home/user/repo', '/src/file.ts')).toBe('/home/user/repo/src/file.ts');
    expect(joinRepoPath('/home/user/repo', '///src/file.ts')).toBe('/home/user/repo/src/file.ts');
  });

  it('handles both trailing and leading slashes', () => {
    expect(joinRepoPath('/repo/', '/file.ts')).toBe('/repo/file.ts');
  });

  it('handles backslashes', () => {
    expect(joinRepoPath('C:\\Users\\repo\\', '\\src\\file.ts')).toBe('C:\\Users\\repo/src\\file.ts');
  });

  it('handles empty relative path', () => {
    expect(joinRepoPath('/repo', '')).toBe('/repo/');
  });
});
