<script lang="ts">
  import { branchState, branchUiState, switchRepoBranch } from '$lib/stores/repo';

  let selectedBranch = '';

  $: if ($branchState.branches.length > 0 && !selectedBranch) {
    selectedBranch = $branchState.current;
  }

  $: if ($branchState.current !== selectedBranch) {
    selectedBranch = $branchState.current;
  }

  async function onSwitchBranch(): Promise<void> {
    if (!selectedBranch || selectedBranch === $branchState.current) {
      return;
    }

    await switchRepoBranch(selectedBranch);
  }
</script>

<section class="branch-selector">
  <div class="row">
    <label for="branch-select">Branch</label>
    <select
      id="branch-select"
      bind:value={selectedBranch}
      on:change={onSwitchBranch}
      disabled={$branchUiState.busy}
    >
      {#each $branchState.branches as branch}
        <option value={branch}>{branch}</option>
      {/each}
    </select>
  </div>

  {#if $branchUiState.error}
    <p class="message error">{$branchUiState.error}</p>
  {:else if $branchUiState.lastAction}
    <p class="message success">{$branchUiState.lastAction}</p>
  {/if}
</section>

<style>
  .branch-selector {
    display: grid;
    gap: 0.4rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  select {
    min-width: 0;
    flex: 1;
  }

  .message {
    margin: 0;
    font-size: 0.8rem;
  }

  .error {
    color: #f85149;
  }

  .success {
    color: #3fb950;
  }
</style>
