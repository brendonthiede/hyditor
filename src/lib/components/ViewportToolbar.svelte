<script lang="ts">
  import { previewState, setViewportPreset } from '$lib/stores/preview';
</script>

<nav class="viewport-toolbar">
  <button on:click={() => setViewportPreset('desktop')}>Desktop</button>
  <button on:click={() => setViewportPreset('tablet')}>Tablet</button>
  <button on:click={() => setViewportPreset('mobile')}>Mobile</button>
  <span>{$previewState.viewport.width}×{$previewState.viewport.height}</span>
</nav>

<style>
  .viewport-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #30363d;
  }
</style>
