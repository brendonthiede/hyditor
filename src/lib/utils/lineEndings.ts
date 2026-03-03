export type LineEnding = 'lf' | 'crlf';

export function detectLineEnding(content: string): LineEnding {
  return content.includes('\r\n') ? 'crlf' : 'lf';
}

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function applyLineEnding(content: string, lineEnding: LineEnding): string {
  const normalized = normalizeLineEndings(content);
  return lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

export function equalsIgnoringLineEndings(left: string, right: string): boolean {
  return normalizeLineEndings(left) === normalizeLineEndings(right);
}