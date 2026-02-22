<script lang="ts">
  import { beginAuth } from '$lib/stores/auth';
</script>

<section class="auth">
  <h1>Hyditor</h1>
  <p>Secure Jekyll editor for GitHub Pages.</p>
  <button on:click={beginAuth}>Sign in with GitHub</button>
</section>

<style>
  .auth {
    height: 100vh;
    display: grid;
    place-content: center;
    gap: 0.75rem;
    text-align: center;
  }

  button {
    padding: 0.6rem 1rem;
  }
</style>
