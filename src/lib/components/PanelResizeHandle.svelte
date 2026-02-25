<script lang="ts">
  /** 'horizontal' = vertical bar between left/right panels (col-resize cursor).
   *  'vertical'   = horizontal bar between top/bottom panels (row-resize cursor). */
  export let orientation: 'horizontal' | 'vertical' = 'horizontal';

  /** Called continuously while dragging with the pixel delta since the last frame. */
  export let onDrag: (delta: number) => void = () => {};

  let active = false;

  function onMouseDown(e: MouseEvent) {
    // Only primary button
    if (e.button !== 0) return;
    e.preventDefault();

    active = true;
    let lastPos = orientation === 'horizontal' ? e.clientX : e.clientY;

    function onMouseMove(evt: MouseEvent) {
      const pos = orientation === 'horizontal' ? evt.clientX : evt.clientY;
      const delta = pos - lastPos;
      lastPos = pos;
      if (delta !== 0) onDrag(delta);
    }

    function onMouseUp() {
      active = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

<!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
<div
  class="resize-handle"
  class:horizontal={orientation === 'horizontal'}
  class:vertical={orientation === 'vertical'}
  class:active
  role="separator"
  aria-orientation={orientation}
  on:mousedown={onMouseDown}
></div>

<style>
  .resize-handle {
    flex-shrink: 0;
    background: #21262d;
    transition: background 0.12s;
    z-index: 5;
    position: relative;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    /* Expand the interactive hit area without increasing the visual size */
    inset: 0;
  }

  .horizontal {
    width: 4px;
    cursor: col-resize;
    align-self: stretch;
  }

  .horizontal::after {
    left: -3px;
    right: -3px;
  }

  .vertical {
    height: 4px;
    cursor: row-resize;
    align-self: stretch;
  }

  .vertical::after {
    top: -3px;
    bottom: -3px;
  }

  .resize-handle:hover,
  .resize-handle.active {
    background: #388bfd;
  }
</style>
