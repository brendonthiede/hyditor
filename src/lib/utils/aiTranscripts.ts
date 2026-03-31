/** AI chat transcript types and analysis for template prompt improvement. */

import type { ChatMessage } from '$lib/tauri/ai';

/**
 * Records when a template is used to start or continue a chat session.
 * Stored on the ChatSession so transcripts persist across app restarts.
 */
export interface TemplateUsage {
  templateId: string;
  templateName: string;
  placeholderValues: Record<string, string>;
  /** The prompt text after placeholder substitution. */
  promptText: string;
  /** Index in the session's messages[] where the template prompt appears. */
  messageIndex: number;
  timestamp: number;
}

/** A single transcript entry for reviewing how a template was used. */
export interface TranscriptEntry {
  sessionId: string;
  sessionTitle: string;
  templateId: string;
  templateName: string;
  placeholderValues: Record<string, string>;
  promptText: string;
  /** Number of user messages sent after the template prompt (before next template or end). */
  followUpCount: number;
  /** Total user+model exchanges in this template's scope. */
  totalExchanges: number;
  createdAt: number;
}

/** Aggregate statistics for a single template across all usages. */
export interface TemplateStats {
  templateId: string;
  templateName: string;
  usageCount: number;
  avgFollowUps: number;
  minFollowUps: number;
  maxFollowUps: number;
  /** Individual transcript entries for drill-down. */
  entries: TranscriptEntry[];
}

/** Minimal session shape needed by transcript analysis. */
export interface TranscriptSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  templateUsages?: TemplateUsage[];
}

/**
 * Compute transcript entries from sessions that have template usages.
 * Each template usage in a session becomes one TranscriptEntry with
 * follow-up count computed from subsequent user messages.
 */
export function computeTranscriptEntries(sessions: TranscriptSession[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];

  for (const session of sessions) {
    if (!session.templateUsages || session.templateUsages.length === 0) continue;

    const usages = [...session.templateUsages].sort(
      (a, b) => a.messageIndex - b.messageIndex,
    );

    for (let i = 0; i < usages.length; i++) {
      const usage = usages[i];
      // Scope: messages from this template's messageIndex to the next template's messageIndex (exclusive), or end
      const scopeStart = usage.messageIndex;
      const scopeEnd =
        i + 1 < usages.length
          ? usages[i + 1].messageIndex
          : session.messages.length;

      const scopeMessages = session.messages.slice(scopeStart, scopeEnd);

      // Follow-ups are user messages after the initial template prompt
      const followUpCount = scopeMessages.filter((m) => m.role === 'user').length - 1;
      const totalExchanges = scopeMessages.length;

      entries.push({
        sessionId: session.id,
        sessionTitle: session.title,
        templateId: usage.templateId,
        templateName: usage.templateName,
        placeholderValues: usage.placeholderValues,
        promptText: usage.promptText,
        followUpCount: Math.max(0, followUpCount),
        totalExchanges,
        createdAt: usage.timestamp,
      });
    }
  }

  // Sort newest first
  entries.sort((a, b) => b.createdAt - a.createdAt);
  return entries;
}

/**
 * Aggregate transcript entries into per-template statistics.
 * Useful for identifying which templates need improvement (high follow-up counts).
 */
export function computeTemplateStats(entries: TranscriptEntry[]): TemplateStats[] {
  const byTemplate = new Map<string, TranscriptEntry[]>();

  for (const entry of entries) {
    const list = byTemplate.get(entry.templateId) ?? [];
    list.push(entry);
    byTemplate.set(entry.templateId, list);
  }

  const stats: TemplateStats[] = [];
  for (const [templateId, templateEntries] of byTemplate) {
    const followUps = templateEntries.map((e) => e.followUpCount);
    const sum = followUps.reduce((a, b) => a + b, 0);

    stats.push({
      templateId,
      templateName: templateEntries[0].templateName,
      usageCount: templateEntries.length,
      avgFollowUps: templateEntries.length > 0 ? sum / templateEntries.length : 0,
      minFollowUps: Math.min(...followUps),
      maxFollowUps: Math.max(...followUps),
      entries: templateEntries,
    });
  }

  // Sort by most used first, then by highest avg follow-ups
  stats.sort((a, b) => b.usageCount - a.usageCount || b.avgFollowUps - a.avgFollowUps);
  return stats;
}
