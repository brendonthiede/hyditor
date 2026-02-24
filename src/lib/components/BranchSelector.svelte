<script lang="ts">
  import { createRepoBranch, branchState, branchUiState, refreshBranches, switchRepoBranch } from '$lib/stores/repo';

  let selectedBranch = '';
  let newBranchName = '';

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

  async function onCreateBranch(): Promise<void> {
    const name = newBranchName.trim();
    if (!name) {
      return;
    }

    await createRepoBranch(name);
    if (!$branchUiState.error) {
      newBranchName = '';
      selectedBranch = name;
    }
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
    <button on:click={refreshBranches} disabled={$branchUiState.busy}>Refresh</button>
  </div>

  <div class="row">
    <input
      type="text"
      bind:value={newBranchName}
      placeholder="new-branch-name"
      disabled={$branchUiState.busy}
    />
    <button on:click={onCreateBranch} disabled={$branchUiState.busy || !newBranchName.trim()}>
      Create branch
    </button>
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
    min-width: 20rem;
  }

  .row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  select,
  input {
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
