/** Line-level diff utilities for displaying AI-suggested changes. */

export type DiffLineType = 'added' | 'removed' | 'context';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

/**
 * Compute the Longest Common Subsequence table for two arrays of strings.
 * Returns a 2D table where lcs[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

interface RawDiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Backtrack through the LCS table to produce a raw diff (all lines, no context filtering).
 */
function backtrack(table: number[][], a: string[], b: string[]): RawDiffLine[] {
  const result: RawDiffLine[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.push({ type: 'context', content: a[i - 1], oldLineNumber: i, newLineNumber: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      result.push({ type: 'added', content: b[j - 1], newLineNumber: j });
      j--;
    } else {
      result.push({ type: 'removed', content: a[i - 1], oldLineNumber: i });
      i--;
    }
  }

  return result.reverse();
}

/**
 * Filter a full diff down to changed hunks with surrounding context lines.
 */
function filterWithContext(rawLines: RawDiffLine[], contextLines: number): DiffLine[] {
  // Find indices of changed lines
  const changedIndices: number[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    if (rawLines[i].type !== 'context') {
      changedIndices.push(i);
    }
  }

  if (changedIndices.length === 0) {
    return [];
  }

  // Determine which lines to include (changed + context)
  const included = new Set<number>();
  for (const idx of changedIndices) {
    for (let c = Math.max(0, idx - contextLines); c <= Math.min(rawLines.length - 1, idx + contextLines); c++) {
      included.add(c);
    }
  }

  const result: DiffLine[] = [];
  let lastIncluded = -2;

  for (let i = 0; i < rawLines.length; i++) {
    if (!included.has(i)) continue;

    // Add separator marker if there's a gap
    if (lastIncluded >= 0 && i > lastIncluded + 1) {
      result.push({ type: 'context', content: '⋯' });
    }

    result.push(rawLines[i]);
    lastIncluded = i;
  }

  return result;
}

/**
 * Compute a unified line diff between two texts.
 *
 * @param oldText - The original file content
 * @param newText - The proposed new content
 * @param contextLines - Number of context lines around each change (default: 3)
 * @returns DiffResult with colorizable diff lines and summary counts
 */
export function computeLineDiff(oldText: string, newText: string, contextLines = 3): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const table = lcsTable(oldLines, newLines);
  const rawLines = backtrack(table, oldLines, newLines);

  const additions = rawLines.filter((l) => l.type === 'added').length;
  const deletions = rawLines.filter((l) => l.type === 'removed').length;

  const lines = filterWithContext(rawLines, contextLines);

  return { lines, additions, deletions };
}
