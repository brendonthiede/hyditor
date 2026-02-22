<script lang="ts">
  import { branchState } from '$lib/stores/repo';
</script>

<label>
  Branch
  <select>
    {#each $branchState.branches as branch}
      <option selected={branch === $branchState.current}>{branch}</option>
    {/each}
  </select>
</label>

<style>
  label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
</style>
