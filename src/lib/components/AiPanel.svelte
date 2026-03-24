<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { activeRepo } from '$lib/stores/repo';
  import { saveRepoFile, openRepoFile } from '$lib/stores/repo';
  import { editorState, fileTree, setCurrentFileContent } from '$lib/stores/editor';
  import { readTree } from '$lib/tauri/fs';
  import {
    aiState,
    loadApiKeyStatus,
    configureApiKey,
    removeApiKey,
    toggleRepoContext,
    clearChat,
    sendMessage,
    changeModel,
    initSessions,
    switchSession,
    startNewChat,
    deleteSession
  } from '$lib/stores/ai';
  import { parseMessageSegments, type FileEdit } from '$lib/utils/aiEdits';

  let inputText = '';
  let apiKeyInput = '';
  let showKeyConfig = false;
  let showHistory = false;
  let messagesEnd: HTMLElement | null = null;
  let textareaEl: HTMLTextAreaElement | null = null;
  /** Tracks which file edits have been applied (by startIndex) */
  let appliedEdits: Set<string> = new Set();
  /** Current position in prompt history (-1 = not browsing) */
  let historyIndex = -1;
  /** Saved input text before browsing history */
  let savedInput = '';

  $: isLoading = $aiState.status === 'loading';

  async function scrollToBottom(): Promise<void> {
    await tick();
    messagesEnd?.scrollIntoView({ behavior: 'smooth' });
  }

  $: if ($aiState.messages.length) void scrollToBottom();

  async function handleSend(): Promise<void> {
    if (!inputText.trim() || isLoading || !$activeRepo) return;
    const msg = inputText;
    inputText = '';
    historyIndex = -1;
    savedInput = '';
    await sendMessage($activeRepo.localPath, msg);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
      return;
    }

    // Prompt history navigation: Up/Down at the top-left of the textarea
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const ta = textareaEl;
      if (!ta) return;

      const prompts = $aiState.promptHistory;
      if (prompts.length === 0) return;

      // Only activate when cursor is at position 0 (top-left)
      if (ta.selectionStart !== 0 || ta.selectionEnd !== 0) return;

      e.preventDefault();

      if (e.key === 'ArrowUp') {
        if (historyIndex === -1) {
          savedInput = inputText;
          historyIndex = 0;
        } else if (historyIndex < prompts.length - 1) {
          historyIndex++;
        } else {
          return; // Already at oldest
        }
        inputText = prompts[historyIndex];
      } else {
        // ArrowDown
        if (historyIndex <= 0) {
          historyIndex = -1;
          inputText = savedInput;
        } else {
          historyIndex--;
          inputText = prompts[historyIndex];
        }
      }
    }
  }

  async function handleSaveKey(): Promise<void> {
    const key = apiKeyInput.trim();
    if (!key) return;
    try {
      await configureApiKey(key);
      apiKeyInput = '';
      showKeyConfig = false;
    } catch (e) {
      // Error is surfaced via store
    }
  }

  async function handleRemoveKey(): Promise<void> {
    await removeApiKey();
    showKeyConfig = false;
  }

  function editKey(edit: FileEdit): string {
    return `${edit.filePath}:${edit.startIndex}`;
  }

  async function refreshTree(): Promise<void> {
    const repo = $activeRepo;
    if (!repo) return;
    const tree = await readTree(repo.localPath);
    fileTree.set(tree);
  }

  async function applyFileEdit(edit: FileEdit): Promise<void> {
    const repo = $activeRepo;
    if (!repo) return;

    try {
      await saveRepoFile(edit.filePath, edit.content);

      // If this is the currently open file, update the editor
      if ($editorState.currentFile === edit.filePath) {
        setCurrentFileContent(edit.filePath, edit.content);
      }

      appliedEdits = new Set([...appliedEdits, editKey(edit)]);
      await refreshTree();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      aiState.update((s) => ({ ...s, error: `Failed to apply ${edit.filePath}: ${msg}` }));
    }
  }

  async function applyAndOpen(edit: FileEdit): Promise<void> {
    const repo = $activeRepo;
    if (!repo) return;

    try {
      await saveRepoFile(edit.filePath, edit.content);
      await refreshTree();
      await openRepoFile(edit.filePath);
      appliedEdits = new Set([...appliedEdits, editKey(edit)]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      aiState.update((s) => ({ ...s, error: `Failed to apply ${edit.filePath}: ${msg}` }));
    }
  }

  function handleSwitchSession(id: string): void {
    switchSession(id);
    appliedEdits = new Set();
    showHistory = false;
  }

  function handleNewChat(): void {
    startNewChat();
    appliedEdits = new Set();
    showHistory = false;
  }

  function handleDeleteSession(e: Event, id: string): void {
    e.stopPropagation();
    deleteSession(id);
  }

  function formatDate(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  onMount(() => {
    void loadApiKeyStatus();
    initSessions();
  });
</script>

<div class="ai-panel">
  <!-- Header -->
  <div class="ai-header">
    <span class="ai-title">AI Assistant</span>
    <div class="ai-header-actions">
      <button
        class="ai-icon-btn"
        class:active={$aiState.includeRepoContext}
        title={$aiState.includeRepoContext
          ? 'Repo context included — click to exclude'
          : 'Repo context excluded — click to include'}
        on:click={toggleRepoContext}
      >
        📁
      </button>
      <button
        class="ai-icon-btn"
        class:active={showHistory}
        title="Chat history"
        on:click={() => (showHistory = !showHistory)}
      >
        🕑
      </button>
      <button
        class="ai-icon-btn"
        title="New chat"
        on:click={handleNewChat}
      >
        ✚
      </button>
      <button
        class="ai-icon-btn"
        title="Clear conversation"
        on:click={clearChat}
      >
        🗑
      </button>
      <button
        class="ai-icon-btn"
        class:active={showKeyConfig}
        title="API key settings"
        on:click={() => (showKeyConfig = !showKeyConfig)}
      >
        ⚙
      </button>
    </div>
  </div>

  <!-- API key config -->
  {#if showKeyConfig}
    <div class="key-config">
      {#if $aiState.apiKeyConfigured}
        <p class="key-status">✓ API key configured</p>
        <div class="key-actions">
          <button class="btn-sm" on:click={handleRemoveKey}>Remove key</button>
          <button class="btn-sm" on:click={() => (showKeyConfig = false)}>Close</button>
        </div>
      {:else}
        <p class="key-status">Enter your Google Gemini API key</p>
        <input
          class="key-input"
          type="password"
          placeholder="AIza..."
          bind:value={apiKeyInput}
          on:keydown={(e) => e.key === 'Enter' && handleSaveKey()}
        />
        <div class="key-actions">
          <button class="btn-sm btn-primary" on:click={handleSaveKey} disabled={!apiKeyInput.trim()}>
            Save
          </button>
          <button class="btn-sm" on:click={() => (showKeyConfig = false)}>Cancel</button>
        </div>
      {/if}
      {#if $aiState.availableModels.length > 0}
        <label class="model-label">
          Model
          <select
            class="model-select"
            value={$aiState.model}
            on:change={(e) => void changeModel(e.currentTarget.value)}
          >
            {#each $aiState.availableModels as m}
              <option value={m}>{m}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
  {/if}

  <!-- Chat history -->
  {#if showHistory}
    <div class="history-panel">
      {#if $aiState.sessions.length === 0}
        <p class="history-empty">No previous chats.</p>
      {:else}
        <div class="history-list">
          {#each $aiState.sessions as session (session.id)}
            <div
              class="history-item"
              class:history-active={session.id === $aiState.activeSessionId}
              on:click={() => handleSwitchSession(session.id)}
              on:keydown={(e) => e.key === 'Enter' && handleSwitchSession(session.id)}
              role="button"
              tabindex="0"
              title={session.title}
            >
              <span class="history-title">{session.title}</span>
              <span class="history-meta">
                <span class="history-date">{formatDate(session.updatedAt)}</span>
                <button
                  class="history-delete"
                  title="Delete chat"
                  on:click={(e) => handleDeleteSession(e, session.id)}
                >×</button>
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Messages area -->
  <div class="ai-messages">
    {#if !$aiState.apiKeyConfigured && $aiState.messages.length === 0}
      <div class="ai-placeholder">
        <p>Configure your <strong>Google Gemini API key</strong> to get started.</p>
        <p>Click the ⚙ button above to add your key.</p>
      </div>
    {:else if $aiState.messages.length === 0}
      <div class="ai-placeholder">
        <p>Ask questions about your Jekyll site or request code changes.</p>
        <p class="dim">
          {#if $aiState.includeRepoContext}
            📁 Repo context will be included with your messages.
          {:else}
            Repo context is disabled. Toggle 📁 to include it.
          {/if}
        </p>
      </div>
    {:else}
      {#each $aiState.messages as message}
        <div class="message" class:message-user={message.role === 'user'} class:message-model={message.role === 'model'}>
          <div class="message-header">{message.role === 'user' ? 'You' : 'Gemini'}</div>
          <div class="message-body">
            {#if message.role === 'model'}
              {#each parseMessageSegments(message.content) as segment}
                {#if segment.type === 'text'}
                  <span class="msg-text">{segment.content}</span>
                {:else}
                  <div class="file-edit-block">
                    <div class="file-edit-header">
                      <span class="file-edit-path">{segment.edit.filePath}</span>
                      <div class="file-edit-actions">
                        {#if appliedEdits.has(editKey(segment.edit))}
                          <span class="applied-badge">✓ Applied</span>
                        {:else}
                          <button
                            class="btn-apply"
                            on:click={() => applyFileEdit(segment.edit)}
                            title="Write this file to disk"
                          >
                            Apply
                          </button>
                          {#if $editorState.currentFile !== segment.edit.filePath}
                            <button
                              class="btn-apply btn-apply-open"
                              on:click={() => applyAndOpen(segment.edit)}
                              title="Write and open in editor"
                            >
                              Apply &amp; Open
                            </button>
                          {/if}
                        {/if}
                      </div>
                    </div>
                    <pre class="file-edit-content"><code>{segment.edit.content}</code></pre>
                  </div>
                {/if}
              {/each}
            {:else}
              {message.content}
            {/if}
          </div>
        </div>
      {/each}
    {/if}

    {#if isLoading}
      <div class="message message-model">
        <div class="message-header">Gemini</div>
        <div class="message-body loading-dots">Thinking…</div>
      </div>
    {/if}

    {#if $aiState.error}
      <div class="ai-error">{$aiState.error}</div>
    {/if}

    <div bind:this={messagesEnd}></div>
  </div>

  <!-- Input area -->
  <div class="ai-input-area">
    <textarea
      bind:this={textareaEl}
      class="ai-input"
      placeholder={$aiState.apiKeyConfigured ? 'Ask about your site… (↑ for history)' : 'Configure API key first…'}
      disabled={!$aiState.apiKeyConfigured || isLoading}
      bind:value={inputText}
      on:keydown={handleKeyDown}
      rows="2"
    ></textarea>
    <button
      class="send-btn"
      disabled={!inputText.trim() || isLoading || !$aiState.apiKeyConfigured}
      on:click={handleSend}
    >
      Send
    </button>
  </div>
</div>

<style>
  .ai-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .ai-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #30363d;
    flex-shrink: 0;
  }

  .ai-title {
    font-weight: 600;
    font-size: 0.85rem;
  }

  .ai-header-actions {
    display: flex;
    gap: 0.25rem;
  }

  .ai-icon-btn {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #c9d1d9;
    cursor: pointer;
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 0.8rem;
    opacity: 0.7;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .ai-icon-btn:hover {
    opacity: 1;
    border-color: #30363d;
  }

  .ai-icon-btn.active {
    border-color: #388bfd;
    color: #79c0ff;
    opacity: 1;
  }

  .key-config {
    padding: 0.75rem;
    border-bottom: 1px solid #30363d;
    display: grid;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .model-label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .model-select {
    width: 100%;
    padding: 0.35rem 0.5rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 0.85rem;
  }

  .model-select:focus {
    border-color: #388bfd;
    outline: none;
  }

  .key-status {
    margin: 0;
    font-size: 0.85rem;
  }

  .key-input {
    width: 100%;
    padding: 0.4rem 0.6rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 0.85rem;
    box-sizing: border-box;
  }

  .key-input:focus {
    border-color: #388bfd;
    outline: none;
  }

  .key-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .btn-sm {
    border: 1px solid #30363d;
    background: transparent;
    color: #c9d1d9;
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .btn-sm:hover {
    border-color: #8b949e;
  }

  .btn-primary {
    background: #238636;
    border-color: #238636;
  }

  .btn-primary:hover {
    background: #2ea043;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .history-panel {
    border-bottom: 1px solid #30363d;
    max-height: 200px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .history-empty {
    padding: 0.75rem;
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.6;
    text-align: center;
  }

  .history-list {
    display: flex;
    flex-direction: column;
  }

  .history-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: transparent;
    border: none;
    border-bottom: 1px solid #21262d;
    color: #c9d1d9;
    cursor: pointer;
    text-align: left;
    font-size: 0.8rem;
    min-height: 32px;
  }

  .history-item:hover {
    background: #161b22;
  }

  .history-item.history-active {
    background: #1f3a5f;
  }

  .history-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .history-meta {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .history-date {
    font-size: 0.7rem;
    opacity: 0.5;
    white-space: nowrap;
  }

  .history-delete {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0 0.15rem;
    line-height: 1;
    opacity: 0;
  }

  .history-item:hover .history-delete {
    opacity: 0.7;
  }

  .history-delete:hover {
    color: #f85149;
    opacity: 1 !important;
  }

  .ai-messages {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ai-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    flex: 1;
    opacity: 0.6;
    font-size: 0.85rem;
    padding: 1rem;
  }

  .ai-placeholder p {
    margin: 0.25rem 0;
  }

  .dim {
    opacity: 0.65;
    font-size: 0.8rem;
  }

  .message {
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    font-size: 0.85rem;
    line-height: 1.45;
    max-width: 100%;
    word-wrap: break-word;
    white-space: pre-wrap;
  }

  .message-user {
    background: #1f3a5f;
    align-self: flex-end;
  }

  .message-model {
    background: #161b22;
    border: 1px solid #30363d;
    align-self: flex-start;
  }

  .message-header {
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 0.25rem;
  }

  .message-body {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg-text {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .file-edit-block {
    margin: 0.5rem 0;
    border: 1px solid #30363d;
    border-radius: 6px;
    overflow: hidden;
    background: #0d1117;
  }

  .file-edit-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.35rem 0.6rem;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    gap: 0.5rem;
  }

  .file-edit-path {
    font-family: monospace;
    font-size: 0.78rem;
    color: #79c0ff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .file-edit-actions {
    display: flex;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .btn-apply {
    background: #238636;
    border: none;
    border-radius: 4px;
    color: #fff;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .btn-apply:hover {
    background: #2ea043;
  }

  .btn-apply-open {
    background: #1f6feb;
  }

  .btn-apply-open:hover {
    background: #388bfd;
  }

  .applied-badge {
    font-size: 0.75rem;
    color: #3fb950;
    font-weight: 500;
  }

  .file-edit-content {
    margin: 0;
    padding: 0.5rem 0.6rem;
    font-size: 0.78rem;
    line-height: 1.45;
    overflow-x: auto;
    max-height: 300px;
    overflow-y: auto;
    white-space: pre;
  }

  .file-edit-content code {
    font-family: monospace;
    color: #c9d1d9;
  }

  .loading-dots {
    opacity: 0.6;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  .ai-error {
    background: rgba(248, 81, 73, 0.1);
    border: 1px solid #f85149;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.8rem;
    color: #f85149;
  }

  .ai-input-area {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem;
    border-top: 1px solid #30363d;
    flex-shrink: 0;
  }

  .ai-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 0.85rem;
    resize: none;
    font-family: inherit;
    line-height: 1.4;
  }

  .ai-input:focus {
    border-color: #388bfd;
    outline: none;
  }

  .ai-input:disabled {
    opacity: 0.5;
  }

  .send-btn {
    align-self: flex-end;
    background: #238636;
    border: none;
    border-radius: 6px;
    color: #fff;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
    font-size: 0.85rem;
    font-weight: 500;
    white-space: nowrap;
  }

  .send-btn:hover:not(:disabled) {
    background: #2ea043;
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
