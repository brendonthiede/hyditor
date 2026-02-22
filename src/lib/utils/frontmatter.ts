import matter from 'gray-matter';

export function parseFrontmatter(content: string): { data: Record<string, unknown>; content: string } {
  const parsed = matter(content);
  return { data: parsed.data, content: parsed.content };
}
