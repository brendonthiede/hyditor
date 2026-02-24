import matter from 'gray-matter';

export function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  const parsed = matter(content);
  return { data: parsed.data, content: parsed.content };
}

function parseFrontmatterValue(value: string): unknown {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return '';
  }

  if (trimmed === 'true') {
    return true;
  }

  if (trimmed === 'false') {
    return false;
  }

  if (trimmed === 'null') {
    return null;
  }

  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber) && trimmed !== '') {
    return asNumber;
  }

  return value;
}

function stringifyWithFrontmatter(content: string, data: Record<string, unknown>): string {
  const parsed = matter(content);
  return matter.stringify(parsed.content, data);
}

export function upsertFrontmatterField(content: string, key: string, value: string): string {
  const normalizedKey = key.trim();
  if (normalizedKey.length === 0) {
    return content;
  }

  const parsed = matter(content);
  const nextData = { ...parsed.data, [normalizedKey]: parseFrontmatterValue(value) };
  return stringifyWithFrontmatter(content, nextData);
}

export function renameFrontmatterField(content: string, previousKey: string, nextKey: string): string {
  const normalizedPrevious = previousKey.trim();
  const normalizedNext = nextKey.trim();

  if (normalizedPrevious.length === 0 || normalizedNext.length === 0 || normalizedPrevious === normalizedNext) {
    return content;
  }

  const parsed = matter(content);
  if (!(normalizedPrevious in parsed.data)) {
    return content;
  }

  const nextData = { ...parsed.data };
  const value = nextData[normalizedPrevious];
  delete nextData[normalizedPrevious];
  nextData[normalizedNext] = value;

  return stringifyWithFrontmatter(content, nextData);
}

export function removeFrontmatterField(content: string, key: string): string {
  const normalizedKey = key.trim();
  if (normalizedKey.length === 0) {
    return content;
  }

  const parsed = matter(content);
  if (!(normalizedKey in parsed.data)) {
    return content;
  }

  const nextData = { ...parsed.data };
  delete nextData[normalizedKey];

  return stringifyWithFrontmatter(content, nextData);
}
