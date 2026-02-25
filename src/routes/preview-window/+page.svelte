<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { emit } from '@tauri-apps/api/event';

  type PreviewPayload = {
    html: string;
    frontmatter: [string, string][];
  };

  let html = '';
  let frontmatter: [string, string][] = [];
  let unlistenUpdate: (() => void) | null = null;

  onMount(async () => {
    // Subscribe to live content updates from the main window.
    unlistenUpdate = await listen<PreviewPayload>('preview-popup-update', (event) => {
      html = event.payload.html;
      frontmatter = event.payload.frontmatter;
    });

    // Tell the main window we are ready so it can push the initial render.
    await emit('preview-popup-ready', {});
  });

  onDestroy(() => {
    unlistenUpdate?.();
  });
</script>

<svelte:head>
  <title>Hyditor Preview</title>
</svelte:head>

<div class="popup-preview">
  {#if frontmatter.length > 0}
    <header class="frontmatter">
      {#each frontmatter as [key, value]}
        <p><strong>{key}:</strong> {value}</p>
      {/each}
    </header>
  {/if}

  <article>
    {@html html}
  </article>
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0d1117;
    color: #e6edf3;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    height: 100%;
  }

  .popup-preview {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    box-sizing: border-box;
  }

  .frontmatter {
    margin-bottom: 1.25rem;
    padding: 0.75rem 1rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: #161b22;
  }

  .frontmatter p {
    margin: 0;
    font-size: 0.85rem;
    color: #8b949e;
  }

  .frontmatter p + p {
    margin-top: 0.3rem;
  }

  .frontmatter strong {
    color: #c9d1d9;
  }

  article {
    flex: 1;
    line-height: 1.7;
    max-width: 80ch;
    word-break: break-word;
  }

  article :global(h1),
  article :global(h2),
  article :global(h3),
  article :global(h4),
  article :global(h5),
  article :global(h6) {
    color: #e6edf3;
    margin-top: 1.5em;
    margin-bottom: 0.5em;
  }

  article :global(p) {
    color: #c9d1d9;
    margin: 0.75em 0;
  }

  article :global(a) {
    color: #58a6ff;
  }

  article :global(code) {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 3px;
    padding: 0.1em 0.35em;
    font-size: 0.88em;
  }

  article :global(pre) {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 1rem;
    overflow: auto;
  }

  article :global(pre code) {
    background: none;
    border: none;
    padding: 0;
  }

  article :global(blockquote) {
    border-left: 4px solid #30363d;
    margin-left: 0;
    padding-left: 1rem;
    color: #8b949e;
  }

  article :global(ul),
  article :global(ol) {
    color: #c9d1d9;
    padding-left: 1.5em;
  }

  article :global(hr) {
    border: none;
    border-top: 1px solid #30363d;
    margin: 1.5em 0;
  }

  article :global(table) {
    border-collapse: collapse;
    width: 100%;
  }

  article :global(th),
  article :global(td) {
    border: 1px solid #30363d;
    padding: 0.4em 0.75em;
    color: #c9d1d9;
  }

  article :global(th) {
    background: #161b22;
    color: #e6edf3;
  }

  article :global(img) {
    max-width: 100%;
  }
</style>
