/**
 * AI meta-analysis: builds a prompt that asks Gemini to review transcript
 * data for a template and suggest an improved prompt.
 */

import type { ChatTemplate } from './aiTemplates';
import type { TranscriptEntry } from './aiTranscripts';
import type { ChatMessage } from '$lib/tauri/ai';

export interface TranscriptWithMessages {
  entry: TranscriptEntry;
  messages: ChatMessage[];
}

/**
 * Build the analysis prompt that will be sent to Gemini.
 * Includes the current template, transcript statistics, and
 * sample conversations so the AI can identify patterns.
 */
export function buildAnalysisPrompt(
  template: ChatTemplate,
  entries: TranscriptEntry[],
  transcripts: TranscriptWithMessages[],
  originalTemplate?: ChatTemplate,
): string {
  const lines: string[] = [];

  lines.push('# Template Prompt Analysis Request');
  lines.push('');
  lines.push('You are analyzing a prompt template used in Hyditor (a Jekyll site editor) to suggest improvements.');
  lines.push('The goal is to reduce the number of follow-up messages users need to send after using this template.');
  lines.push('A lower follow-up count means the template produced better results on the first try.');
  lines.push('');

  // Current template
  lines.push('## Current Template');
  lines.push(`**Name:** ${template.name}`);
  lines.push(`**Description:** ${template.description}`);
  lines.push(`**Placeholders:** ${template.placeholders.map((p) => `{{${p.key}}} (${p.label})`).join(', ') || '(none)'}`);
  lines.push('```');
  lines.push(template.prompt);
  lines.push('```');
  lines.push('');

  // Show original if this is an overridden built-in
  if (originalTemplate && originalTemplate.prompt !== template.prompt) {
    lines.push('## Original Built-in Template (for reference)');
    lines.push('```');
    lines.push(originalTemplate.prompt);
    lines.push('```');
    lines.push('');
  }

  // Aggregate stats
  const followUps = entries.map((e) => e.followUpCount);
  const totalFollowUps = followUps.reduce((a, b) => a + b, 0);
  const avgFollowUps = entries.length > 0 ? totalFollowUps / entries.length : 0;

  lines.push('## Usage Statistics');
  lines.push(`- Total uses: ${entries.length}`);
  lines.push(`- Average follow-ups per use: ${avgFollowUps.toFixed(1)}`);
  lines.push(`- Min follow-ups: ${Math.min(...followUps)}`);
  lines.push(`- Max follow-ups: ${Math.max(...followUps)}`);
  lines.push(`- Zero follow-up rate: ${entries.filter((e) => e.followUpCount === 0).length}/${entries.length} (${entries.length > 0 ? ((entries.filter((e) => e.followUpCount === 0).length / entries.length) * 100).toFixed(0) : 0}%)`);
  lines.push('');

  // Sample conversations (limit to most recent 5 to stay within context)
  const samples = transcripts.slice(0, 5);
  if (samples.length > 0) {
    lines.push('## Sample Conversations');
    lines.push('');
    lines.push('Below are sample conversations started from this template.');
    lines.push('Each shows the initial prompt (from the template) and any follow-up exchanges.');
    lines.push('Focus on what users asked for in follow-ups — these reveal gaps in the template.');
    lines.push('');

    for (let i = 0; i < samples.length; i++) {
      const { entry, messages } = samples[i];
      lines.push(`### Conversation ${i + 1} (${entry.followUpCount} follow-ups)`);
      if (Object.keys(entry.placeholderValues).length > 0) {
        lines.push('**Placeholder values:** ' +
          Object.entries(entry.placeholderValues)
            .map(([k, v]) => `${k}="${v}"`)
            .join(', '));
      }
      lines.push('');
      for (const msg of messages) {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        // Truncate long assistant responses for analysis
        const content = msg.content.length > 500
          ? msg.content.slice(0, 500) + '\n[... truncated for analysis ...]'
          : msg.content;
        lines.push(`**${role}:**`);
        lines.push(content);
        lines.push('');
      }
    }
  }

  lines.push('## Your Task');
  lines.push('');
  lines.push('Based on the usage data and sample conversations above, provide:');
  lines.push('');
  lines.push('1. **Analysis**: What patterns do you see in the follow-up messages? What information do users repeatedly have to provide after the initial template prompt?');
  lines.push('2. **Suggested improvements**: Specific changes to the template prompt that would reduce follow-ups.');
  lines.push('3. **New placeholder suggestions**: Any new `{{placeholder}}` fields that should be added to capture information users commonly provide in follow-ups.');
  lines.push('4. **Improved prompt**: The complete improved template prompt, ready to use. Put it in a code block labeled `improved-prompt` like this:');
  lines.push('');
  lines.push('```improved-prompt');
  lines.push('Your improved prompt template here with {{placeholders}}');
  lines.push('```');
  lines.push('');
  lines.push('5. **New placeholders**: List any new placeholders with their labels, in this format:');
  lines.push('');
  lines.push('```improved-placeholders');
  lines.push('placeholder_key: Label text');
  lines.push('another_key: Another label');
  lines.push('```');

  return lines.join('\n');
}

/**
 * Parse the AI's analysis response to extract the improved prompt and placeholders.
 * Returns null if the response doesn't contain the expected format.
 */
export function parseAnalysisResponse(response: string): {
  improvedPrompt: string;
  placeholders: { key: string; label: string }[];
} | null {
  // Extract improved prompt
  const promptMatch = response.match(
    /```improved-prompt\n([\s\S]*?)```/,
  );
  if (!promptMatch) return null;

  const improvedPrompt = promptMatch[1].trimEnd();

  // Extract placeholders (optional)
  const placeholders: { key: string; label: string }[] = [];
  const phMatch = response.match(
    /```improved-placeholders\n([\s\S]*?)```/,
  );
  if (phMatch) {
    const phLines = phMatch[1].trim().split('\n');
    for (const line of phLines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const key = line.slice(0, colonIdx).trim();
      const label = line.slice(colonIdx + 1).trim();
      if (key && label) {
        placeholders.push({ key, label });
      }
    }
  }

  // If no placeholders block, extract from the prompt itself
  if (placeholders.length === 0) {
    const seen = new Set<string>();
    const re = /\{\{(\w+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(improvedPrompt)) !== null) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        placeholders.push({
          key: m[1],
          label: m[1].charAt(0).toUpperCase() + m[1].slice(1).replace(/_/g, ' '),
        });
      }
    }
  }

  return { improvedPrompt, placeholders };
}
