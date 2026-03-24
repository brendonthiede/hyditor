export interface FileEdit {
  filePath: string;
  content: string;
  /** Character offset of the start of whole ```file:... block in the original text */
  startIndex: number;
  /** Character offset just past the closing ``` */
  endIndex: number;
}

/**
 * Parses AI response content for file edit blocks.
 *
 * Looks for fenced code blocks tagged with a file path:
 *
 *     ```file:path/to/file.md
 *     <complete file contents>
 *     ```
 *
 * Returns an array of FileEdit objects extracted from the text.
 */
export function parseFileEdits(text: string): FileEdit[] {
  const edits: FileEdit[] = [];
  // Match ```file:some/path possibly followed by a newline, then content, then closing ```
  const pattern = /^```file:([^\n]+)\n([\s\S]*?)^```$/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const filePath = match[1].trim();
    // Remove a single trailing newline from content if present, since it's an artifact of the fenced block
    let content = match[2];
    if (content.endsWith('\n')) {
      content = content.slice(0, -1);
    }
    edits.push({
      filePath,
      content,
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return edits;
}

/**
 * Splits a message into segments of plain text and file edit blocks,
 * preserving order for rendering.
 */
export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'fileEdit'; edit: FileEdit };

export function parseMessageSegments(text: string): MessageSegment[] {
  const edits = parseFileEdits(text);
  if (edits.length === 0) {
    return [{ type: 'text', content: text }];
  }

  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const edit of edits) {
    if (edit.startIndex > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, edit.startIndex) });
    }
    segments.push({ type: 'fileEdit', edit });
    cursor = edit.endIndex;
  }

  if (cursor < text.length) {
    segments.push({ type: 'text', content: text.slice(cursor) });
  }

  return segments;
}
