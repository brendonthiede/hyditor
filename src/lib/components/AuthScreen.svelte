<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { authState, beginAuth, logOut } from '$lib/stores/auth';
  import { resetRepoSession } from '$lib/stores/repo';
  import { shouldShowLocalSessionRecovery } from '$lib/utils/authErrors';

  let clearingLocalSession = false;

  async function clearLocalSession(): Promise<void> {
    clearingLocalSession = true;
    try {
      await logOut();
      resetRepoSession();
    } finally {
      clearingLocalSession = false;
    }
  }

  async function openExternal(url: string): Promise<void> {
    try {
      await openUrl(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  $: showLocalRecovery = shouldShowLocalSessionRecovery($authState.message);
</script>

<section class="auth">
  <h1>Hyditor</h1>
  <p>Secure Jekyll editor for GitHub Pages.</p>

  {#if $authState.status === 'pending'}
    <div class="device-flow">
      {#if $authState.verificationUri}
        <p>
          Open
          <a
            href={$authState.verificationUri}
            target="_blank"
            rel="noreferrer"
            on:click|preventDefault={() => openExternal($authState.verificationUri!)}>{$authState.verificationUri}</a
          >
          and enter:
        </p>
      {/if}
      {#if $authState.userCode}<p class="code">{$authState.userCode}</p>{/if}
      {#if $authState.message}<p>{$authState.message}</p>{/if}
      {#if $authState.pollStatus}
        <p class="poll-status">Last poll status: {$authState.pollStatus}</p>
      {/if}
    </div>
  {/if}

  {#if $authState.status === 'error' && $authState.message}
    <p class="error">{$authState.message}</p>
    {#if showLocalRecovery}
      <button class="secondary" on:click={clearLocalSession} disabled={clearingLocalSession}>
        {clearingLocalSession ? 'Clearing local session…' : 'Clear local session'}
      </button>
      <p class="hint">
        If this looks like a token/session expiry issue, clear local session and sign in again. Optional remote revocation is available in
        <a href="https://github.com/settings/applications" target="_blank" rel="noreferrer">GitHub application settings</a>.
      </p>
    {/if}
  {/if}

  <button on:click={beginAuth} disabled={$authState.status === 'pending'}>
    {$authState.status === 'pending' ? 'Waiting for authorization…' : 'Sign in with GitHub'}
  </button>
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

  .device-flow {
    display: grid;
    gap: 0.5rem;
    max-width: 36rem;
  }

  .code {
    margin: 0;
    padding: 0.4rem 0.6rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    font-family: monospace;
    font-size: 1.05rem;
  }

  .error {
    color: #f85149;
  }

  .secondary {
    justify-self: center;
    padding: 0.45rem 0.8rem;
    border: 1px solid #30363d;
    border-radius: 6px;
    background: transparent;
    color: inherit;
  }

  .hint {
    margin: 0;
    font-size: 0.9rem;
    opacity: 0.85;
    max-width: 36rem;
  }

  .poll-status {
    margin: 0;
    font-size: 0.8rem;
    opacity: 0.75;
  }
</style>
