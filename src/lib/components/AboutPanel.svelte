<script lang="ts">
  import { onMount } from 'svelte';
  import { getVersion, getTauriVersion } from '@tauri-apps/api/app';
  import { openPath, openUrl } from '@tauri-apps/plugin-opener';
  import { writeText as writeClipboardText } from '@tauri-apps/plugin-clipboard-manager';
  import { activeRepo, branchState } from '$lib/stores/repo';
  import { getPreviewLogDirectory } from '$lib/tauri/preview';

  let appVersion = '';
  let tauriVersion = '';
  let copied = false;
  let logError: string | null = null;

  $: osInfo = typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown';
  $: repoOwner = $activeRepo?.owner ?? '';
  $: repoName = $activeRepo?.name ?? '';
  $: repoPath = $activeRepo?.localPath ?? '';
  $: branch = $branchState.current;

  onMount(async () => {
    try {
      appVersion = await getVersion();
    } catch {
      appVersion = 'unknown';
    }
    try {
      tauriVersion = await getTauriVersion();
    } catch {
      tauriVersion = 'unknown';
    }
  });

  function buildDiagnostics(): string {
    const lines = [
      `Hyditor v${appVersion}`,
      `Tauri: ${tauriVersion}`,
      `OS: ${osInfo}`,
    ];
    if (repoOwner && repoName) {
      lines.push(`Repo: ${repoOwner}/${repoName}`);
      lines.push(`Branch: ${branch}`);
      lines.push(`Local path: ${repoPath}`);
    }
    return lines.join('\n');
  }

  async function copyDiagnostics(): Promise<void> {
    try {
      await writeClipboardText(buildDiagnostics());
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch {
      // Silently ignore clipboard errors
    }
  }

  async function openLogFolder(): Promise<void> {
    logError = null;
    try {
      const dir = await getPreviewLogDirectory();
      await openPath(dir);
    } catch {
      logError = 'Could not open log folder.';
    }
  }
</script>

<div class="about-panel">
  <h3 class="about-title">About Hyditor</h3>

  <dl class="info-list">
    <dt>Version</dt>
    <dd>{appVersion || '…'}</dd>

    <dt>Tauri</dt>
    <dd>{tauriVersion || '…'}</dd>

    <dt>OS</dt>
    <dd class="os-value">{osInfo}</dd>

    {#if repoOwner && repoName}
      <dt>Repository</dt>
      <dd>{repoOwner}/{repoName}</dd>

      <dt>Branch</dt>
      <dd>{branch}</dd>

      <dt>Local path</dt>
      <dd class="path-value">{repoPath}</dd>
    {/if}
  </dl>

  {#if logError}
    <p class="log-error">{logError}</p>
  {/if}

  <div class="about-actions">
    <button class="about-btn" on:click={() => void openLogFolder()} title="Open application log folder">
      Open log folder
    </button>
    <button class="about-btn" on:click={() => void copyDiagnostics()} title="Copy diagnostic info to clipboard">
      {copied ? 'Copied!' : 'Copy diagnostics'}
    </button>
    <button
      class="about-btn about-link"
      on:click={() => void openUrl('https://github.com/brendonthiede/hyditor')}
      title="Open Hyditor on GitHub"
    >
      GitHub ↗
    </button>
  </div>
</div>

<style>
  .about-panel {
    position: absolute;
    right: 0;
    top: calc(100% + 0.35rem);
    width: 26rem;
    max-width: min(26rem, 90vw);
    border: 1px solid #30363d;
    border-radius: 8px;
    background: #0d1117;
    padding: 0.75rem;
    z-index: 10;
    display: grid;
    gap: 0.5rem;
  }

  .about-title {
    margin: 0;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .info-list {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.2rem 0.75rem;
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .info-list dt {
    font-weight: 500;
    opacity: 0.65;
    white-space: nowrap;
  }

  .info-list dd {
    margin: 0;
    word-break: break-all;
  }

  .os-value,
  .path-value {
    font-size: 0.8rem;
    opacity: 0.85;
  }

  .log-error {
    color: #f85149;
    font-size: 0.8rem;
    margin: 0;
  }

  .about-actions {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .about-btn {
    border: 1px solid #30363d;
    background: transparent;
    color: #c9d1d9;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
    font-weight: 500;
  }

  .about-btn:hover {
    border-color: #8b949e;
    background: #161b22;
  }

  .about-link {
    color: #58a6ff;
  }
</style>
