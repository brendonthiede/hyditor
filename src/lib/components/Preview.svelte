<script lang="ts">
  import ViewportToolbar from '$lib/components/ViewportToolbar.svelte';
  import { editorState } from '$lib/stores/editor';
  import { renderMarkdown } from '$lib/utils/markdown';

  $: rendered = renderMarkdown($editorState.currentContent);
</script>

<section class="preview">
  <ViewportToolbar />
  <article>{@html rendered}</article>
</section>

<style>
  .preview {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
  }

  article {
    overflow: auto;
    padding: 0.75rem;
  }
</style>
