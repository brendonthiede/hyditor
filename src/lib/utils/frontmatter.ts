import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

type ParsedFrontmatterDocument = {
  data: Record<string, unknown>;
  content: string;
};

function parseFrontmatterDocument(content: string): ParsedFrontmatterDocument {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { data: {}, content };
  }

  const yamlSource = match[1] ?? '';
  const body = content.slice(match[0].length);

  try {
    const parsed = parseYaml(yamlSource);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { data: {}, content: body };
    }

    return { data: parsed as Record<string, unknown>, content: body };
  } catch {
    return { data: {}, content: body };
  }
}

function stringifyFrontmatterDocument(content: string, data: Record<string, unknown>): string {
  const parsed = parseFrontmatterDocument(content);
  const body = parsed.content;
  const keys = Object.keys(data);

  if (keys.length === 0) {
    return body;
  }

  const yaml = stringifyYaml(data).trimEnd();
  return `---\n${yaml}\n---\n\n${body}`;
}

export function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  return parseFrontmatterDocument(content);
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
  return stringifyFrontmatterDocument(content, data);
}

export function upsertFrontmatterField(content: string, key: string, value: string): string {
  const normalizedKey = key.trim();
  if (normalizedKey.length === 0) {
    return content;
  }

  const parsed = parseFrontmatterDocument(content);
  const nextData = { ...parsed.data, [normalizedKey]: parseFrontmatterValue(value) };
  return stringifyWithFrontmatter(content, nextData);
}

export function renameFrontmatterField(content: string, previousKey: string, nextKey: string): string {
  const normalizedPrevious = previousKey.trim();
  const normalizedNext = nextKey.trim();

  if (normalizedPrevious.length === 0 || normalizedNext.length === 0 || normalizedPrevious === normalizedNext) {
    return content;
  }

  const parsed = parseFrontmatterDocument(content);
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

  const parsed = parseFrontmatterDocument(content);
  if (!(normalizedKey in parsed.data)) {
    return content;
  }

  const nextData = { ...parsed.data };
  delete nextData[normalizedKey];

  return stringifyWithFrontmatter(content, nextData);
}
