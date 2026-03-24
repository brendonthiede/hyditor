<script lang="ts">
  import { onMount } from 'svelte';
  import { checkForUpdate, downloadAndInstall, type UpdateInfo } from '$lib/tauri/updater';

  let updateInfo: UpdateInfo | null = null;
  let dismissed = false;
  let installing = false;
  let error: string | null = null;

  onMount(async () => {
    updateInfo = await checkForUpdate();
  });

  async function handleInstall(): Promise<void> {
    installing = true;
    error = null;
    try {
      await downloadAndInstall();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      installing = false;
    }
  }

  function dismiss(): void {
    dismissed = true;
  }
</script>

{#if updateInfo && !dismissed}
  <div class="update-banner">
    <span class="update-text">
      Update available: <strong>v{updateInfo.version}</strong>
    </span>
    {#if error}
      <span class="update-error">{error}</span>
    {/if}
    <div class="update-actions">
      {#if installing}
        <span class="update-installing">Installing…</span>
      {:else}
        <button class="update-btn update-install" on:click={() => void handleInstall()}>
          Install &amp; Restart
        </button>
        <button class="update-btn update-dismiss" on:click={dismiss}>
          Later
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .update-banner {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    background: #1f3a5f;
    border-bottom: 1px solid #388bfd;
    font-size: 0.85rem;
    flex-wrap: wrap;
  }

  .update-text {
    flex: 1;
    min-width: 0;
  }

  .update-error {
    color: #f85149;
    font-size: 0.8rem;
  }

  .update-actions {
    display: flex;
    gap: 0.4rem;
    flex-shrink: 0;
  }

  .update-installing {
    font-size: 0.8rem;
    opacity: 0.7;
  }

  .update-btn {
    border: none;
    border-radius: 4px;
    padding: 0.25rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
    font-weight: 500;
  }

  .update-install {
    background: #238636;
    color: #fff;
  }

  .update-install:hover {
    background: #2ea043;
  }

  .update-dismiss {
    background: transparent;
    border: 1px solid #30363d;
    color: #c9d1d9;
  }

  .update-dismiss:hover {
    border-color: #8b949e;
  }
</style>
