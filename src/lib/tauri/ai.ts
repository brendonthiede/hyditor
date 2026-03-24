import { tauriInvoke } from '$lib/tauri/runtime';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

export async function saveGeminiApiKey(apiKey: string): Promise<void> {
  await tauriInvoke('save_gemini_api_key', { apiKey });
}

export async function getGeminiApiKey(): Promise<string | null> {
  return tauriInvoke<string | null>('get_gemini_api_key');
}

export async function clearGeminiApiKey(): Promise<void> {
  await tauriInvoke('clear_gemini_api_key');
}

export async function getGeminiModel(): Promise<string> {
  return tauriInvoke<string>('get_gemini_model');
}

export async function setGeminiModel(model: string): Promise<void> {
  await tauriInvoke('set_gemini_model', { model });
}

export async function listGeminiModels(): Promise<string[]> {
  return tauriInvoke<string[]>('list_gemini_models');
}

export async function geminiChat(
  repoPath: string,
  messages: ChatMessage[],
  includeRepoContext: boolean,
  model?: string,
  currentFile?: string | null,
  currentFileContent?: string
): Promise<ChatMessage> {
  return tauriInvoke<ChatMessage>('gemini_chat', {
    repoPath,
    messages,
    includeRepoContext,
    model,
    currentFile: currentFile ?? null,
    currentFileContent: currentFileContent ?? null
  });
}
