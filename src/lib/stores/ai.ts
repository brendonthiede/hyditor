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

export type AiStatus = 'idle' | 'loading' | 'streaming' | 'error';

// ── Chat session types ──────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
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
  model: string;
  availableModels: string[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  /** All user prompts across sessions, newest first */
  promptHistory: string[];
}

const DEFAULTS: AiState = {
  status: 'idle',
  apiKeyConfigured: false,
  messages: [],
  error: null,
  includeRepoContext: true,
  model: 'gemini-2.5-flash',
  availableModels: [],
  sessions: [],
  activeSessionId: null,
  promptHistory: [],
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
  aiState.update((s) => ({ ...s, sessions, promptHistory }));
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
    let currentModel = '';
    aiState.subscribe((s) => {
      currentMessages = s.messages;
      includeContext = s.includeRepoContext;
      currentModel = s.model;
    })();

    // Get currently open file context for the AI
    const editor = get(editorState);
    const currentFile = editor.currentFile;
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
