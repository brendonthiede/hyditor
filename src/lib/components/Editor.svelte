<script lang="ts">
  import { editorState, updateCurrentContent } from '$lib/stores/editor';
</script>

<section class="editor">
  <h3>Editor</h3>
  <textarea
    value={$editorState.currentContent}
    on:input={(event) => updateCurrentContent((event.target as HTMLTextAreaElement).value)}
  ></textarea>
</section>

<style>
  .editor {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    padding: 0.75rem;
    gap: 0.5rem;
  }

  textarea {
    width: 100%;
    height: 100%;
    resize: none;
    border: 1px solid #30363d;
    background: transparent;
    color: inherit;
    padding: 0.75rem;
  }
</style>
