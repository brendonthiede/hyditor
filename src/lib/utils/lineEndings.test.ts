import { describe, expect, it } from 'vitest';
import {
  applyLineEnding,
  detectLineEnding,
  equalsIgnoringLineEndings,
  normalizeLineEndings
} from './lineEndings';

describe('lineEndings', () => {
  it('detects CRLF content', () => {
    expect(detectLineEnding('a\r\nb\r\n')).toBe('crlf');
  });

  it('detects LF content', () => {
    expect(detectLineEnding('a\nb\n')).toBe('lf');
  });

  it('normalizes all line endings to LF', () => {
    expect(normalizeLineEndings('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });

  it('applies CRLF line endings', () => {
    expect(applyLineEnding('a\nb\n', 'crlf')).toBe('a\r\nb\r\n');
  });

  it('applies LF line endings', () => {
    expect(applyLineEnding('a\r\nb\r\n', 'lf')).toBe('a\nb\n');
  });

  it('compares content ignoring line ending style', () => {
    expect(equalsIgnoringLineEndings('a\r\nb\r\n', 'a\nb\n')).toBe(true);
  });
});