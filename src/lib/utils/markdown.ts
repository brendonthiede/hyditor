import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';

export function renderMarkdown(markdown: string): string {
  const file = unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).processSync(markdown);
  return String(file);
}
