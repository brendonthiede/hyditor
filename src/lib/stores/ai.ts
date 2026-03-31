import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import {
  getGeminiApiKey,
  saveGeminiApiKey,
  clearGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
  listGeminiModels,
  geminiChat,
  type ChatMessage
} from '$lib/tauri/ai';
import { editorState } from '$lib/stores/editor';
import {
  type ChatTemplate,
  type BuiltInOverride,
  type PromptVersion,
  BUILT_IN_TEMPLATES,
  loadCustomTemplates,
  persistCustomTemplates,
  loadBuiltInOverrides,
  persistBuiltInOverrides,
  getAllTemplates,
  createPromptVersion,
  getOriginalBuiltInTemplate,
} from '$lib/utils/aiTemplates';
import {
  type TemplateUsage,
  type TranscriptEntry,
  computeTranscriptEntries,
  computeTemplateStats,
} from '$lib/utils/aiTranscripts';
import { buildAnalysisPrompt } from '$lib/utils/aiMetaAnalysis';

export type AiStatus = 'idle' | 'loading' | 'streaming' | 'error';

// ── Chat session types ──────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** Template usages recorded during this session (for transcript analysis). */
  templateUsages?: TemplateUsage[];
}

const SESSIONS_STORAGE_KEY = 'hyditor-ai-sessions';
const MAX_SESSIONS = 50;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user');
  if (!first) return 'New chat';
  const text = first.content.trim();
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

function loadSessions(): ChatSession[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

function persistSessions(sessions: ChatSession[]): void {
  if (!browser) return;
  // Keep only the most recent MAX_SESSIONS
  const trimmed = sessions.slice(0, MAX_SESSIONS);
  localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(trimmed));
}

// ── Store state ─────────────────────────────────────────────────────

export interface AiState {
  status: AiStatus;
  apiKeyConfigured: boolean;
  messages: ChatMessage[];
  error: string | null;
  includeRepoContext: boolean;
  includeFileContext: boolean;
  model: string;
  availableModels: string[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  /** All user prompts across sessions, newest first */
  promptHistory: string[];
  /** All available templates (built-in + custom) */
  templates: ChatTemplate[];
  /** Custom templates only (for persistence) */
  customTemplates: ChatTemplate[];
  /** User overrides for built-in templates (prompt + placeholder changes). */
  builtInOverrides: BuiltInOverride[];
  /** Template usage pending attachment to next sent message. */
  pendingTemplateUsage: Omit<TemplateUsage, 'messageIndex' | 'timestamp'> | null;
}

const DEFAULTS: AiState = {
  status: 'idle',
  apiKeyConfigured: false,
  messages: [],
  error: null,
  includeRepoContext: true,
  includeFileContext: true,
  model: 'gemini-2.5-flash',
  availableModels: [],
  sessions: [],
  activeSessionId: null,
  promptHistory: [],
  templates: [...BUILT_IN_TEMPLATES],
  customTemplates: [],
  builtInOverrides: [],
  pendingTemplateUsage: null,
};

/** Extract deduplicated user prompts from sessions, newest-first. */
function buildPromptHistory(sessions: ChatSession[]): string[] {
  const seen = new Set<string>();
  const prompts: string[] = [];
  // Walk sessions newest-first, messages newest-first within each
  for (const session of sessions) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const m = session.messages[i];
      if (m.role === 'user' && !seen.has(m.content)) {
        seen.add(m.content);
        prompts.push(m.content);
      }
    }
  }
  return prompts;
}

export const aiState = writable<AiState>({ ...DEFAULTS });

// ── Session management ──────────────────────────────────────────────

export function initSessions(): void {
  const sessions = loadSessions();
  const promptHistory = buildPromptHistory(sessions);
  const customTemplates = browser ? loadCustomTemplates() : [];
  const builtInOverrides = browser ? loadBuiltInOverrides() : [];
  const templates = getAllTemplates(customTemplates, builtInOverrides);
  aiState.update((s) => ({ ...s, sessions, promptHistory, customTemplates, builtInOverrides, templates }));
}

/** Save current messages as the active session (or create a new one). */
function saveActiveSession(): void {
  const state = get(aiState);
  if (state.messages.length === 0) return;

  const now = Date.now();
  let sessions = [...state.sessions];

  if (state.activeSessionId) {
    const idx = sessions.findIndex((s) => s.id === state.activeSessionId);
    if (idx >= 0) {
      sessions[idx] = {
        ...sessions[idx],
        messages: state.messages,
        title: sessionTitle(state.messages),
        updatedAt: now,
      };
      // Move to front (most recent)
      const [updated] = sessions.splice(idx, 1);
      sessions.unshift(updated);
    }
  } else {
    const newSession: ChatSession = {
      id: generateId(),
      title: sessionTitle(state.messages),
      messages: state.messages,
      createdAt: now,
      updatedAt: now,
    };
    sessions.unshift(newSession);
    aiState.update((s) => ({ ...s, activeSessionId: newSession.id }));
  }

  // Attach any pending template usage to the active session
  if (state.pendingTemplateUsage) {
    const sessionIdx = sessions.findIndex(
      (s) => s.id === (state.activeSessionId ?? sessions[0]?.id),
    );
    if (sessionIdx >= 0) {
      const session = sessions[sessionIdx];
      // The template prompt is the most recent user message before the last model reply
      const msgIdx = state.messages.length >= 2 ? state.messages.length - 2 : 0;
      const usage: TemplateUsage = {
        ...state.pendingTemplateUsage,
        messageIndex: msgIdx,
        timestamp: now,
      };
      sessions[sessionIdx] = {
        ...session,
        templateUsages: [...(session.templateUsages ?? []), usage],
      };
    }
    aiState.update((s) => ({ ...s, pendingTemplateUsage: null }));
  }

  persistSessions(sessions);
  const promptHistory = buildPromptHistory(sessions);
  aiState.update((s) => ({ ...s, sessions, promptHistory }));
}

export function switchSession(sessionId: string): void {
  const state = get(aiState);
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) return;
  aiState.update((s) => ({
    ...s,
    messages: [...session.messages],
    activeSessionId: sessionId,
    error: null,
    status: 'idle',
  }));
}

export function startNewChat(): void {
  // Save current session first if it has messages
  const state = get(aiState);
  if (state.messages.length > 0) {
    saveActiveSession();
  }
  aiState.update((s) => ({
    ...s,
    messages: [],
    activeSessionId: null,
    error: null,
    status: 'idle',
  }));
}

export function deleteSession(sessionId: string): void {
  const state = get(aiState);
  const sessions = state.sessions.filter((s) => s.id !== sessionId);
  persistSessions(sessions);
  const promptHistory = buildPromptHistory(sessions);

  // If we deleted the active session, clear messages
  if (state.activeSessionId === sessionId) {
    aiState.update((s) => ({
      ...s,
      sessions,
      promptHistory,
      activeSessionId: null,
      messages: [],
      error: null,
      status: 'idle',
    }));
  } else {
    aiState.update((s) => ({ ...s, sessions, promptHistory }));
  }
}

export async function loadApiKeyStatus(): Promise<void> {
  try {
    const [key, model, models] = await Promise.all([
      getGeminiApiKey(),
      getGeminiModel(),
      listGeminiModels(),
    ]);
    aiState.update((s) => ({
      ...s,
      apiKeyConfigured: key !== null,
      model,
      availableModels: models,
    }));
  } catch {
    aiState.update((s) => ({ ...s, apiKeyConfigured: false }));
  }
}

export async function configureApiKey(key: string): Promise<void> {
  await saveGeminiApiKey(key);
  aiState.update((s) => ({ ...s, apiKeyConfigured: true, error: null }));
}

export async function removeApiKey(): Promise<void> {
  await clearGeminiApiKey();
  aiState.update((s) => ({ ...s, apiKeyConfigured: false }));
}

export function toggleRepoContext(): void {
  aiState.update((s) => ({ ...s, includeRepoContext: !s.includeRepoContext }));
}

export function toggleFileContext(): void {
  aiState.update((s) => ({ ...s, includeFileContext: !s.includeFileContext }));
}

// ── Template management ─────────────────────────────────────────────

function generateTemplateId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function addCustomTemplate(
  template: Omit<ChatTemplate, 'id' | 'builtIn'>,
): void {
  const newTemplate: ChatTemplate = {
    ...template,
    id: generateTemplateId(),
    builtIn: false,
    versions: [createPromptVersion(template.prompt, template.placeholders, [], 'Initial version')],
  };
  aiState.update((s) => {
    const customTemplates = [...s.customTemplates, newTemplate];
    persistCustomTemplates(customTemplates);
    return { ...s, customTemplates, templates: getAllTemplates(customTemplates, s.builtInOverrides) };
  });
}

export function updateCustomTemplate(
  id: string,
  updates: Partial<Omit<ChatTemplate, 'id' | 'builtIn'>>,
  changeNote?: string,
): void {
  aiState.update((s) => {
    const customTemplates = s.customTemplates.map((t) => {
      if (t.id !== id) return t;
      const updated = { ...t, ...updates };
      // Add a version entry if the prompt changed
      if (updates.prompt && updates.prompt !== t.prompt) {
        const versions = t.versions ?? [];
        const newVersion = createPromptVersion(
          updates.prompt,
          updates.placeholders ?? t.placeholders,
          versions,
          changeNote,
        );
        updated.versions = [newVersion, ...versions];
      }
      return updated;
    });
    persistCustomTemplates(customTemplates);
    return { ...s, customTemplates, templates: getAllTemplates(customTemplates, s.builtInOverrides) };
  });
}

export function deleteCustomTemplate(id: string): void {
  aiState.update((s) => {
    const customTemplates = s.customTemplates.filter((t) => t.id !== id);
    persistCustomTemplates(customTemplates);
    return { ...s, customTemplates, templates: getAllTemplates(customTemplates, s.builtInOverrides) };
  });
}

// ── Built-in template overrides ─────────────────────────────────────

/**
 * Override a built-in template's prompt and placeholders.
 * Creates a new version and persists the override.
 */
export function overrideBuiltInTemplate(
  id: string,
  prompt: string,
  placeholders: ChatTemplate['placeholders'],
  changeNote?: string,
): void {
  aiState.update((s) => {
    const existing = s.builtInOverrides.find((o) => o.id === id);
    const versions = existing?.versions ?? [];
    const newVersion = createPromptVersion(prompt, placeholders, versions, changeNote);
    const override: BuiltInOverride = {
      id,
      prompt,
      placeholders,
      versions: [newVersion, ...versions],
    };
    const builtInOverrides = existing
      ? s.builtInOverrides.map((o) => (o.id === id ? override : o))
      : [...s.builtInOverrides, override];
    persistBuiltInOverrides(builtInOverrides);
    return { ...s, builtInOverrides, templates: getAllTemplates(s.customTemplates, builtInOverrides) };
  });
}

/**
 * Revert a built-in template to a specific version from its history.
 */
export function revertBuiltInToVersion(id: string, version: number): void {
  aiState.update((s) => {
    const existing = s.builtInOverrides.find((o) => o.id === id);
    if (!existing) return s;
    const target = existing.versions.find((v) => v.version === version);
    if (!target) return s;
    const newVersion = createPromptVersion(
      target.prompt,
      target.placeholders,
      existing.versions,
      `Reverted to v${version}`,
    );
    const override: BuiltInOverride = {
      id,
      prompt: target.prompt,
      placeholders: target.placeholders,
      versions: [newVersion, ...existing.versions],
    };
    const builtInOverrides = s.builtInOverrides.map((o) => (o.id === id ? override : o));
    persistBuiltInOverrides(builtInOverrides);
    return { ...s, builtInOverrides, templates: getAllTemplates(s.customTemplates, builtInOverrides) };
  });
}

/**
 * Remove a built-in override — restores the original template.
 */
export function resetBuiltInTemplate(id: string): void {
  aiState.update((s) => {
    const builtInOverrides = s.builtInOverrides.filter((o) => o.id !== id);
    persistBuiltInOverrides(builtInOverrides);
    return { ...s, builtInOverrides, templates: getAllTemplates(s.customTemplates, builtInOverrides) };
  });
}

/**
 * Revert a custom template to a specific version from its history.
 */
export function revertCustomToVersion(id: string, version: number): void {
  aiState.update((s) => {
    const customTemplates = s.customTemplates.map((t) => {
      if (t.id !== id) return t;
      const versions = t.versions ?? [];
      const target = versions.find((v) => v.version === version);
      if (!target) return t;
      const newVersion = createPromptVersion(
        target.prompt,
        target.placeholders,
        versions,
        `Reverted to v${version}`,
      );
      return {
        ...t,
        prompt: target.prompt,
        placeholders: target.placeholders,
        versions: [newVersion, ...versions],
      };
    });
    persistCustomTemplates(customTemplates);
    return { ...s, customTemplates, templates: getAllTemplates(customTemplates, s.builtInOverrides) };
  });
}

// ── Template transcript tracking ────────────────────────────────────

/**
 * Record that a template was just applied. The usage will be attached to
 * the session when the next message is sent and the session is saved.
 */
export function setPendingTemplateUsage(
  templateId: string,
  templateName: string,
  placeholderValues: Record<string, string>,
  promptText: string,
): void {
  aiState.update((s) => ({
    ...s,
    pendingTemplateUsage: { templateId, templateName, placeholderValues, promptText },
  }));
}

/** Get transcript entries for all sessions that used templates. */
export function getTranscriptEntries() {
  const state = get(aiState);
  return computeTranscriptEntries(state.sessions);
}

/** Get per-template aggregate statistics from transcripts. */
export function getTemplateStats() {
  return computeTemplateStats(getTranscriptEntries());
}

/**
 * Run AI meta-analysis on a template's transcript history.
 * Sends the template prompt, transcript data, and follow-up conversations
 * to Gemini and asks it to suggest an improved prompt.
 * Returns the analysis as a chat in the current session.
 */
export async function runTemplateAnalysis(
  repoPath: string,
  templateId: string,
): Promise<void> {
  const state = get(aiState);
  const template = state.templates.find((t) => t.id === templateId);
  if (!template) return;

  const entries = getTranscriptEntries().filter((e) => e.templateId === templateId);
  if (entries.length === 0) return;

  // Collect the follow-up messages for each transcript entry
  const transcriptMessages: { entry: TranscriptEntry; messages: ChatMessage[] }[] = [];
  for (const entry of entries) {
    const session = state.sessions.find((s) => s.id === entry.sessionId);
    if (!session) continue;
    // Get messages from template prompt to next template or end
    const usages = (session.templateUsages ?? [])
      .filter((u) => u.templateId === templateId)
      .sort((a, b) => a.messageIndex - b.messageIndex);
    const usageIdx = usages.findIndex((u) => u.timestamp === entry.createdAt);
    if (usageIdx < 0) continue;
    const startIdx = usages[usageIdx].messageIndex;
    const endIdx = usageIdx + 1 < usages.length
      ? usages[usageIdx + 1].messageIndex
      : session.messages.length;
    transcriptMessages.push({
      entry,
      messages: session.messages.slice(startIdx, endIdx),
    });
  }

  const original = getOriginalBuiltInTemplate(templateId);
  const analysisPrompt = buildAnalysisPrompt(template, entries, transcriptMessages, original);

  // Start a new chat and send the analysis prompt
  startNewChat();
  await sendMessage(repoPath, analysisPrompt);
}

export async function changeModel(model: string): Promise<void> {
  await setGeminiModel(model);
  aiState.update((s) => ({ ...s, model }));
}

export function clearChat(): void {
  startNewChat();
}

export async function sendMessage(repoPath: string, userMessage: string): Promise<void> {
  const trimmed = userMessage.trim();
  if (!trimmed) return;

  const userMsg: ChatMessage = { role: 'user', content: trimmed };

  aiState.update((s) => ({
    ...s,
    messages: [...s.messages, userMsg],
    status: 'loading',
    error: null,
  }));

  try {
    // Get current state to pass full history
    let currentMessages: ChatMessage[] = [];
    let includeContext = true;
    let includeFile = true;
    let currentModel = '';
    aiState.subscribe((s) => {
      currentMessages = s.messages;
      includeContext = s.includeRepoContext;
      includeFile = s.includeFileContext;
      currentModel = s.model;
    })();

    // Get currently open file context for the AI
    const editor = get(editorState);
    const currentFile = includeFile ? editor.currentFile : null;
    const currentFileContent = currentFile ? editor.currentContent : undefined;

    const reply = await geminiChat(repoPath, currentMessages, includeContext, currentModel, currentFile, currentFileContent);

    aiState.update((s) => ({
      ...s,
      messages: [...s.messages, reply],
      status: 'idle',
    }));

    // Persist session after each exchange
    saveActiveSession();
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    aiState.update((s) => ({
      ...s,
      status: 'error',
      error: errorMsg,
    }));
  }
}
