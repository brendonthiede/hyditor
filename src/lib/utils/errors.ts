/**
 * Shared error-handling helpers.
 *
 * Extracted from auth.ts (toErrorMessage) and repo.ts (getErrorMessage) so the
 * logic lives in one place and can be tested independently.
 */

/**
 * Extract a human-readable message from an unknown error value.
 *
 * Handles `Error` instances, bare strings, and plain objects with a `message`
 * property.  Returns `null` when no meaningful message can be derived.
 */
export function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
      return maybeMessage;
    }
  }

  return null;
}

/**
 * Same as {@link getErrorMessage} but returns a fallback string instead of
 * `null` when no message can be derived.
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  return getErrorMessage(error) ?? fallback;
}

/**
 * Check whether a file path points to a Markdown file (`.md` or `.markdown`).
 */
export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

/**
 * Check whether a file path points to an HTML file (`.html`).
 */
export function isHtmlPath(path: string): boolean {
  return path.toLowerCase().endsWith('.html');
}

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif'
]);

/**
 * Check whether a file path points to an image file.
 */
export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
};

/**
 * Return the MIME type for a known image extension, defaulting to
 * `application/octet-stream` for unrecognised extensions.
 */
export function getImageMimeType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME_MAP[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Check whether a file path points to a content file that can be edited and
 * previewed — currently Markdown (`.md`, `.markdown`) or HTML (`.html`).
 */
export function isContentPath(path: string): boolean {
  return isMarkdownPath(path) || isHtmlPath(path);
}

/**
 * Join a repo local path with a relative file path, normalising separators.
 */
export function joinRepoPath(localPath: string, relativePath: string): string {
  const trimmedBase = localPath.replace(/[\\/]+$/, '');
  const trimmedRelative = relativePath.replace(/^[/\\]+/, '');
  return `${trimmedBase}/${trimmedRelative}`;
}
