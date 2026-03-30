import { describe, it, expect } from 'vitest';
import { computeLineDiff } from './diff';

describe('computeLineDiff', () => {
  it('returns empty diff for identical texts', () => {
    const result = computeLineDiff('hello\nworld', 'hello\nworld');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('detects a simple addition', () => {
    const result = computeLineDiff('line1\nline2', 'line1\nline2\nline3');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    const added = result.lines.filter((l) => l.type === 'added');
    expect(added).toHaveLength(1);
    expect(added[0].content).toBe('line3');
  });

  it('detects a simple removal', () => {
    const result = computeLineDiff('line1\nline2\nline3', 'line1\nline3');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(1);
    const removed = result.lines.filter((l) => l.type === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].content).toBe('line2');
  });

  it('detects a modification (remove + add)', () => {
    const result = computeLineDiff('line1\nold line\nline3', 'line1\nnew line\nline3');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    const removed = result.lines.filter((l) => l.type === 'removed');
    const added = result.lines.filter((l) => l.type === 'added');
    expect(removed[0].content).toBe('old line');
    expect(added[0].content).toBe('new line');
  });

  it('includes context lines around changes', () => {
    const oldText = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
    const newText = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h'].join('\n');
    const result = computeLineDiff(oldText, newText, 2);

    // Should include 2 context lines before and after the change
    const contextBefore = result.lines.filter(
      (l) => l.type === 'context' && l.content !== '⋯' && (l.oldLineNumber ?? 0) < 4
    );
    const contextAfter = result.lines.filter(
      (l) => l.type === 'context' && l.content !== '⋯' && (l.oldLineNumber ?? 0) > 4
    );
    expect(contextBefore.length).toBeLessThanOrEqual(2);
    expect(contextAfter.length).toBeLessThanOrEqual(2);
  });

  it('handles empty old text (new file)', () => {
    const result = computeLineDiff('', 'line1\nline2');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1); // The empty string splits to [''], which gets removed
  });

  it('handles empty new text (deleted file)', () => {
    const result = computeLineDiff('line1\nline2', '');
    expect(result.deletions).toBe(2);
    expect(result.additions).toBe(1); // The empty string splits to [''], which gets added
  });

  it('handles both texts empty', () => {
    const result = computeLineDiff('', '');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.lines).toEqual([]);
  });

  it('inserts separator for distant changes', () => {
    const oldLines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const newLines = [...oldLines];
    newLines[2] = 'CHANGED3';
    newLines[17] = 'CHANGED18';

    const result = computeLineDiff(oldLines.join('\n'), newLines.join('\n'), 2);
    const separators = result.lines.filter((l) => l.content === '⋯');
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });

  it('provides line numbers for context and changed lines', () => {
    const result = computeLineDiff('a\nb\nc', 'a\nB\nc');
    const removed = result.lines.find((l) => l.type === 'removed');
    const added = result.lines.find((l) => l.type === 'added');
    expect(removed?.oldLineNumber).toBe(2);
    expect(added?.newLineNumber).toBe(2);
  });

  it('handles multi-line additions in the middle', () => {
    const result = computeLineDiff('a\nb\nc', 'a\nb\nX\nY\nc');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
    const added = result.lines.filter((l) => l.type === 'added');
    expect(added.map((l) => l.content)).toEqual(['X', 'Y']);
  });
});
