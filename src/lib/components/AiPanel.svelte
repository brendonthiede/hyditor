<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { activeRepo } from '$lib/stores/repo';
  import { saveRepoFile, openRepoFile } from '$lib/stores/repo';
  import { editorState, fileTree, setCurrentFileContent } from '$lib/stores/editor';
  import { readFile, readTree } from '$lib/tauri/fs';
  import {
    aiState,
    loadApiKeyStatus,
    configureApiKey,
    removeApiKey,
    toggleRepoContext,
    toggleFileContext,
    clearChat,
    sendMessage,
    changeModel,
    initSessions,
    switchSession,
    startNewChat,
    deleteSession,
    addCustomTemplate,
    updateCustomTemplate,
    deleteCustomTemplate
  } from '$lib/stores/ai';
  import { parseMessageSegments, type FileEdit } from '$lib/utils/aiEdits';
  import { applyPlaceholders, extractPostMetadata, type ChatTemplate, type TemplatePlaceholder } from '$lib/utils/aiTemplates';
  import { computeLineDiff, type DiffResult } from '$lib/utils/diff';

  let inputText = '';
  let apiKeyInput = '';
  let showKeyConfig = false;
  let showHistory = false;
  let messagesEnd: HTMLElement | null = null;
  let textareaEl: HTMLTextAreaElement | null = null;
  let panelEl: HTMLElement | null = null;
  /** Tracks which file edits have been applied (by startIndex) */
  let appliedEdits: Set<string> = new Set();
  /** View mode per file edit: 'diff' or 'code' */
  let editViewModes: Record<string, 'diff' | 'code'> = {};
  /** Cached original file content for computing diffs */
  let originalContents: Record<string, string | null> = {};
  /** Cached diff results */
  let diffResults: Record<string, DiffResult> = {};
  /** Tracks which file edits are loading original content */
  let loadingOriginals: Set<string> = new Set();
  /** Current position in prompt history (-1 = not browsing) */
  let historyIndex = -1;
  /** Saved input text before browsing history */
  let savedInput = '';
  let showTemplates = false;
  let selectedTemplate: ChatTemplate | null = null;
  let templateValues: Record<string, string> = {};
  /** Per-field suggestions (e.g. existing categories/tags from posts). */
  let fieldSuggestions: Record<string, string[]> = {};
  let showTemplateEditor = false;
  let editingTemplate: ChatTemplate | null = null;
  let editTemplateName = '';
  let editTemplateDescription = '';
  let editTemplatePrompt = '';

  $: isLoading = $aiState.status === 'loading';

  /** Auto-resize textarea to fit content, up to 50% of panel height. */
  function autoResizeTextarea(): void {
    const ta = textareaEl;
    if (!ta) return;
    // Reset to auto so scrollHeight reflects actual content
    ta.style.height = 'auto';
    const maxHeight = panelEl ? panelEl.clientHeight * 0.5 : 300;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    // Allow manual resize beyond auto height
    ta.style.maxHeight = 'none';
  }

  $: if (inputText !== undefined && textareaEl) {
    void tick().then(autoResizeTextarea);
  }

  async function scrollToBottom(): Promise<void> {
    await tick();
    messagesEnd?.scrollIntoView({ behavior: 'smooth' });
  }

  $: if ($aiState.messages.length) void scrollToBottom();

  // Load original file content for any new file-edit segments in assistant messages
  $: {
    for (const message of $aiState.messages) {
      if (message.role !== 'model') continue;
      for (const seg of parseMessageSegments(message.content)) {
        if (seg.type === 'fileEdit') {
          void loadOriginalForEdit(seg.edit);
        }
      }
    }
  }

  async function handleSend(): Promise<void> {
    if (!inputText.trim() || isLoading || !$activeRepo) return;
    const msg = inputText;
    inputText = '';
    historyIndex = -1;
    savedInput = '';
    if (textareaEl) {
      textareaEl.style.height = 'auto';
    }
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

  function selectTemplate(template: ChatTemplate): void {
    selectedTemplate = template;
    templateValues = {};
    fieldSuggestions = {};
    for (const p of template.placeholders) {
      templateValues[p.key] = p.default ?? '';
    }
    if (template.id === 'builtin-new-post') {
      void loadPostSuggestions();
    }
  }

  async function loadPostSuggestions(): Promise<void> {
    const repo = $activeRepo;
    if (!repo) return;
    try {
      const tree = $fileTree.length > 0 ? $fileTree : await readTree(repo.localPath);
      const postFiles = tree.filter(
        (f) => !f.is_dir && f.path.match(/^_posts\/.*\.(?:md|markdown)$/i)
      );
      const contents = await Promise.all(
        postFiles.map((f) => readFile(`${repo.localPath}/${f.path}`).catch(() => ''))
      );
      const meta = extractPostMetadata(contents.filter(Boolean));
      fieldSuggestions = { categories: meta.categories, tags: meta.tags };
    } catch {
      // Non-critical — suggestions just won't appear
    }
  }

  /** Toggle a suggestion value in a comma-separated template field. */
  function toggleSuggestion(key: string, value: string): void {
    const current = templateValues[key] ?? '';
    const items = current.split(',').map((s) => s.trim()).filter(Boolean);
    const idx = items.indexOf(value);
    if (idx >= 0) {
      items.splice(idx, 1);
    } else {
      items.push(value);
    }
    templateValues[key] = items.join(', ');
  }

  /** Check if a suggestion value is currently selected in a comma-separated field. */
  function isSuggestionSelected(key: string, value: string): boolean {
    const current = templateValues[key] ?? '';
    return current.split(',').map((s) => s.trim()).includes(value);
  }

  function applyTemplate(): void {
    if (!selectedTemplate) return;
    inputText = applyPlaceholders(selectedTemplate.prompt, templateValues);
    selectedTemplate = null;
    templateValues = {};
    fieldSuggestions = {};
    showTemplates = false;
  }

  function cancelTemplate(): void {
    selectedTemplate = null;
    templateValues = {};
    fieldSuggestions = {};
  }

  function openNewTemplateEditor(): void {
    editingTemplate = null;
    editTemplateName = '';
    editTemplateDescription = '';
    editTemplatePrompt = '';
    showTemplateEditor = true;
  }

  function openEditTemplate(t: ChatTemplate): void {
    editingTemplate = t;
    editTemplateName = t.name;
    editTemplateDescription = t.description;
    editTemplatePrompt = t.prompt;
    showTemplateEditor = true;
  }

  function saveTemplateEditor(): void {
    const name = editTemplateName.trim();
    const prompt = editTemplatePrompt.trim();
    if (!name || !prompt) return;

    const placeholderKeys = prompt.match(/\{\{(\w+)\}\}/g)?.map((m) => m.slice(2, -2)) ?? [];
    const uniqueKeys = [...new Set(placeholderKeys)];
    const placeholders: TemplatePlaceholder[] = uniqueKeys.map((key) => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
    }));

    if (editingTemplate) {
      updateCustomTemplate(editingTemplate.id, {
        name,
        description: editTemplateDescription.trim(),
        prompt,
        placeholders,
      });
    } else {
      addCustomTemplate({
        name,
        description: editTemplateDescription.trim(),
        prompt,
        placeholders,
      });
    }
    showTemplateEditor = false;
  }

  function cancelTemplateEditor(): void {
    showTemplateEditor = false;
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

  /** Load original file content for an edit to enable diff view. */
  async function loadOriginalForEdit(edit: FileEdit): Promise<void> {
    const key = editKey(edit);
    if (key in originalContents || loadingOriginals.has(key)) return;

    const repo = $activeRepo;
    if (!repo) return;

    loadingOriginals = new Set([...loadingOriginals, key]);
    try {
      const fullPath = `${repo.localPath}/${edit.filePath}`;
      const content = await readFile(fullPath);
      originalContents = { ...originalContents, [key]: content };
      diffResults = { ...diffResults, [key]: computeLineDiff(content, edit.content) };
      // Default to diff view when original is available
      if (!(key in editViewModes)) {
        editViewModes = { ...editViewModes, [key]: 'diff' };
      }
    } catch {
      // File doesn't exist yet (new file) — no diff available
      originalContents = { ...originalContents, [key]: null };
    }
    loadingOriginals = new Set([...loadingOriginals].filter((k) => k !== key));
  }

  function toggleEditViewMode(key: string): void {
    const current = editViewModes[key] ?? 'code';
    editViewModes = { ...editViewModes, [key]: current === 'diff' ? 'code' : 'diff' };
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

<div class="ai-panel" bind:this={panelEl}>
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
        class:active={$aiState.includeFileContext}
        title={$aiState.includeFileContext
          ? `File context included${$editorState.currentFile ? ` (​${$editorState.currentFile}​)` : ''} — click to exclude`
          : 'File context excluded — click to include'}
        on:click={toggleFileContext}
      >
        📄
      </button>
      <button
        class="ai-icon-btn"
        class:active={showTemplates}
        title="Prompt templates"
        on:click={() => (showTemplates = !showTemplates)}
      >
        📋
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

  <!-- Template picker -->
  {#if showTemplates}
    <div class="template-panel">
      {#if showTemplateEditor}
        <div class="template-editor">
          <input class="template-editor-input" type="text" placeholder="Template name" bind:value={editTemplateName} />
          <input class="template-editor-input" type="text" placeholder="Description (optional)" bind:value={editTemplateDescription} />
          <textarea class="template-editor-prompt" placeholder={'Prompt text (use {{placeholder}} for variables)'} bind:value={editTemplatePrompt} rows="4"></textarea>
          <div class="template-editor-actions">
            <button class="btn-sm btn-primary" on:click={saveTemplateEditor} disabled={!editTemplateName.trim() || !editTemplatePrompt.trim()}>
              {editingTemplate ? 'Update' : 'Create'}
            </button>
            <button class="btn-sm" on:click={cancelTemplateEditor}>Cancel</button>
          </div>
        </div>
      {:else if selectedTemplate}
        <div class="template-fill">
          <div class="template-fill-fields">
            <p class="template-fill-name">{selectedTemplate.name}</p>
            {#each selectedTemplate.placeholders as ph (ph.key)}
              <label class="template-field">
                <span class="template-field-label">{ph.label}</span>
                <input class="template-field-input" type="text" bind:value={templateValues[ph.key]} placeholder={ph.default ?? ''} />
              </label>
              {#if fieldSuggestions[ph.key]?.length}
                <div class="suggestion-chips">
                  {#each fieldSuggestions[ph.key] as suggestion}
                    <button
                      class="suggestion-chip"
                      class:suggestion-chip-active={isSuggestionSelected(ph.key, suggestion)}
                      on:click={() => toggleSuggestion(ph.key, suggestion)}
                      type="button"
                    >{suggestion}</button>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
          <div class="template-fill-actions">
            <button class="btn-sm btn-primary" on:click={applyTemplate}>Use Template</button>
            <button class="btn-sm" on:click={cancelTemplate}>Cancel</button>
          </div>
        </div>
      {:else}
        <div class="template-list">
          {#each $aiState.templates as t (t.id)}
            <div class="template-item">
              <button class="template-item-btn" on:click={() => selectTemplate(t)} title={t.description}>
                <span class="template-item-name">{t.name}</span>
                {#if !t.builtIn}<span class="template-custom-badge">custom</span>{/if}
              </button>
              {#if !t.builtIn}
                <button class="template-action-btn" title="Edit" on:click={() => openEditTemplate(t)}>✎</button>
                <button class="template-action-btn template-delete-btn" title="Delete" on:click={() => deleteCustomTemplate(t.id)}>×</button>
              {/if}
            </div>
          {/each}
        </div>
        <div class="template-footer">
          <button class="btn-sm" on:click={openNewTemplateEditor}>+ New Template</button>
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
        {#if $aiState.includeFileContext && $editorState.currentFile}
          <p class="dim">📄 Focused: <code class="file-focus-name">{$editorState.currentFile}</code></p>
        {:else if !$aiState.includeFileContext}
          <p class="dim">File context is disabled. Toggle 📄 to include it.</p>
        {/if}
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
                  {@const ek = editKey(segment.edit)}
                  <div class="file-edit-block">
                    <div class="file-edit-header">
                      <span class="file-edit-path">{segment.edit.filePath}</span>
                      <div class="file-edit-actions">
                        {#if originalContents[ek] != null && diffResults[ek]}
                          <button
                            class="btn-view-toggle"
                            class:active={editViewModes[ek] === 'diff'}
                            on:click={() => toggleEditViewMode(ek)}
                            title={editViewModes[ek] === 'diff' ? 'Show full source' : 'Show changes'}
                          >
                            {editViewModes[ek] === 'diff' ? '< >' : 'Diff'}
                          </button>
                        {:else if originalContents[ek] === null}
                          <span class="new-file-badge">new file</span>
                        {/if}
                        {#if appliedEdits.has(ek)}
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
                    {#if editViewModes[ek] === 'diff' && diffResults[ek]}
                      {@const diff = diffResults[ek]}
                      <div class="diff-summary">
                        {#if diff.additions > 0}<span class="diff-stat-add">+{diff.additions}</span>{/if}
                        {#if diff.deletions > 0}<span class="diff-stat-del">-{diff.deletions}</span>{/if}
                        {#if diff.additions === 0 && diff.deletions === 0}<span class="diff-stat-none">No changes</span>{/if}
                      </div>
                      <div class="diff-content">
                        {#each diff.lines as line}
                          <div
                            class="diff-line"
                            class:diff-line-added={line.type === 'added'}
                            class:diff-line-removed={line.type === 'removed'}
                            class:diff-line-context={line.type === 'context'}
                            class:diff-line-separator={line.content === '⋯'}
                          >
                            <span class="diff-gutter">{#if line.type === 'added'}+{:else if line.type === 'removed'}-{:else}&nbsp;{/if}</span>
                            <span class="diff-line-num">{#if line.type !== 'context' || line.content === '⋯'}&nbsp;{:else}{line.oldLineNumber ?? ''}{/if}</span>
                            <span class="diff-text">{line.content}</span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <pre class="file-edit-content"><code>{segment.edit.content}</code></pre>
                    {/if}
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
    {#if $aiState.includeFileContext && $editorState.currentFile}
      <div class="file-focus-bar">📄 <code class="file-focus-name">{$editorState.currentFile}</code></div>
    {/if}
    <div class="ai-input-row">
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

  /* Template panel */
  .template-panel {
    border-bottom: 1px solid #30363d;
    max-height: 250px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  .template-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    min-height: 0;
  }

  .template-item {
    display: flex;
    align-items: center;
    border-bottom: 1px solid #21262d;
  }

  .template-item-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.75rem;
    background: transparent;
    border: none;
    color: #c9d1d9;
    cursor: pointer;
    text-align: left;
    font-size: 0.8rem;
    min-height: 32px;
  }

  .template-item-btn:hover {
    background: #161b22;
  }

  .template-item-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .template-custom-badge {
    font-size: 0.65rem;
    opacity: 0.5;
    background: #30363d;
    padding: 0.05rem 0.25rem;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .template-action-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.2rem 0.3rem;
    opacity: 0;
  }

  .template-item:hover .template-action-btn {
    opacity: 0.7;
  }

  .template-action-btn:hover {
    opacity: 1 !important;
    color: #c9d1d9;
  }

  .template-delete-btn:hover {
    color: #f85149 !important;
  }

  .template-footer {
    padding: 0.4rem 0.75rem;
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .template-fill {
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-height: 0;
    flex: 1;
  }

  .template-fill-fields {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow-y: auto;
    min-height: 0;
    flex: 1;
  }

  .template-fill-name {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .template-field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.8rem;
  }

  .template-field-label {
    opacity: 0.7;
    font-size: 0.75rem;
  }

  .template-field-input {
    padding: 0.3rem 0.5rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #c9d1d9;
    font-size: 0.8rem;
  }

  .template-field-input:focus {
    border-color: #388bfd;
    outline: none;
  }

  .suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.1rem;
  }

  .suggestion-chip {
    padding: 0.1rem 0.4rem;
    font-size: 0.7rem;
    border: 1px solid #30363d;
    border-radius: 10px;
    background: #161b22;
    color: #8b949e;
    cursor: pointer;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }

  .suggestion-chip:hover {
    background: #21262d;
    color: #c9d1d9;
  }

  .suggestion-chip-active {
    background: #1f3a5f;
    border-color: #388bfd;
    color: #c9d1d9;
  }

  .suggestion-chip-active:hover {
    background: #1a3050;
  }

  .template-fill-actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
    margin-top: 0.2rem;
    flex-shrink: 0;
  }

  .template-editor {
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    overflow-y: auto;
    min-height: 0;
  }

  .template-editor-input {
    padding: 0.3rem 0.5rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #c9d1d9;
    font-size: 0.8rem;
  }

  .template-editor-input:focus {
    border-color: #388bfd;
    outline: none;
  }

  .template-editor-prompt {
    padding: 0.3rem 0.5rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #c9d1d9;
    font-size: 0.8rem;
    font-family: inherit;
    resize: vertical;
    min-height: 60px;
  }

  .template-editor-prompt:focus {
    border-color: #388bfd;
    outline: none;
  }

  .template-editor-actions {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-end;
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

  .file-focus-name {
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    font-size: 0.78rem;
    color: #79c0ff;
    background: #161b22;
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
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

  /* View mode toggle button */
  .btn-view-toggle {
    background: transparent;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #8b949e;
    padding: 0.15rem 0.4rem;
    cursor: pointer;
    font-size: 0.7rem;
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    white-space: nowrap;
  }

  .btn-view-toggle:hover {
    border-color: #8b949e;
    color: #c9d1d9;
  }

  .btn-view-toggle.active {
    border-color: #388bfd;
    color: #79c0ff;
  }

  .new-file-badge {
    font-size: 0.7rem;
    color: #3fb950;
    background: rgba(63, 185, 80, 0.12);
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-weight: 500;
  }

  /* Diff summary stats */
  .diff-summary {
    display: flex;
    gap: 0.5rem;
    padding: 0.25rem 0.6rem;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    border-bottom: 1px solid #21262d;
    background: #0d1117;
  }

  .diff-stat-add {
    color: #3fb950;
    font-weight: 600;
  }

  .diff-stat-del {
    color: #f85149;
    font-weight: 600;
  }

  .diff-stat-none {
    color: #8b949e;
  }

  /* Diff content container */
  .diff-content {
    max-height: 400px;
    overflow-y: auto;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, monospace;
    font-size: 0.75rem;
    line-height: 1.5;
  }

  /* Individual diff lines */
  .diff-line {
    display: flex;
    white-space: pre;
    min-width: fit-content;
  }

  .diff-line-added {
    background: rgba(63, 185, 80, 0.15);
  }

  .diff-line-removed {
    background: rgba(248, 81, 73, 0.15);
  }

  .diff-line-context {
    background: transparent;
  }

  .diff-line-separator {
    background: rgba(56, 139, 253, 0.08);
    justify-content: center;
  }

  /* Diff gutter (+/-/space indicator) */
  .diff-gutter {
    display: inline-block;
    width: 1.2em;
    text-align: center;
    flex-shrink: 0;
    user-select: none;
    color: #8b949e;
    padding-left: 0.3rem;
  }

  .diff-line-added .diff-gutter {
    color: #3fb950;
  }

  .diff-line-removed .diff-gutter {
    color: #f85149;
  }

  /* Diff line numbers */
  .diff-line-num {
    display: inline-block;
    width: 3em;
    text-align: right;
    flex-shrink: 0;
    color: #484f58;
    padding-right: 0.5rem;
    user-select: none;
  }

  /* Diff text content */
  .diff-text {
    flex: 1;
    padding-right: 0.5rem;
  }

  .diff-line-added .diff-text {
    color: #aff5b4;
  }

  .diff-line-removed .diff-text {
    color: #ffa198;
  }

  .diff-line-context .diff-text {
    color: #8b949e;
  }

  .diff-line-separator .diff-text {
    color: #388bfd;
    font-style: italic;
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
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem;
    border-top: 1px solid #30363d;
    flex-shrink: 0;
  }

  .file-focus-bar {
    font-size: 0.75rem;
    color: #8b949e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ai-input-row {
    display: flex;
    gap: 0.5rem;
  }

  .ai-input {
    flex: 1;
    padding: 0.4rem 0.6rem;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 0.85rem;
    resize: vertical;
    font-family: inherit;
    line-height: 1.4;
    min-height: 2.8em;
    overflow-y: auto;
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
