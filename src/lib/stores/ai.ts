import { writable, get } from 'svelte/store';
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

export interface AiState {
  status: AiStatus;
  apiKeyConfigured: boolean;
  messages: ChatMessage[];
  error: string | null;
  includeRepoContext: boolean;
  model: string;
  availableModels: string[];
}

const DEFAULTS: AiState = {
  status: 'idle',
  apiKeyConfigured: false,
  messages: [],
  error: null,
  includeRepoContext: true,
  model: 'gemini-2.5-flash',
  availableModels: [],
};

export const aiState = writable<AiState>({ ...DEFAULTS });

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
  aiState.update((s) => ({ ...s, messages: [], error: null, status: 'idle' }));
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
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    aiState.update((s) => ({
      ...s,
      status: 'error',
      error: errorMsg,
    }));
  }
}
