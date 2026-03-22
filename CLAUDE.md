# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Hyditor is a desktop-native editor and previewer for Jekyll sites on GitHub Pages, built with Tauri v2 (Rust backend) + SvelteKit + TypeScript (frontend).

## Commands

```bash
# Install dependencies
npm install

# Run in development (loads .env automatically)
npm run tauri:dev

# Build production binary
npm run tauri:build

# Frontend type-check
npm run check

# Frontend lint
npm run lint

# Frontend tests (Vitest)
npm test

# Watch mode for frontend tests
npm run test:watch

# Run a single frontend test file
npm test -- src/lib/utils/markdown.test.ts

# Rust tests (must be run from src-tauri/)
cd src-tauri && cargo test

# Regenerate platform icons from source (src-tauri/app-icon.png)
npx tauri icon src-tauri/app-icon.png
```

## Architecture

### Frontend (`src/`)

SvelteKit with `adapter-static` (no SSR — Tauri loads it as a local web app).

- `src/routes/+page.svelte` — top-level app shell; renders auth → repo selector → workspace based on state
- `src/routes/preview-window/` — standalone route for the preview pop-out native window
- `src/lib/components/` — Svelte UI components (Editor, Preview, FileTree, GitPanel, SearchPanel, BranchSelector, FrontMatterForm, etc.)
- `src/lib/stores/` — Svelte stores managing global state (auth, repo, editor, preview, layout)
- `src/lib/tauri/` — IPC wrappers that call Rust commands via `@tauri-apps/api/core` (auth, git, github, fs, preview, session, window)
- `src/lib/utils/` — Pure utility functions (markdown rendering, front matter parsing, Jekyll URL resolution, line ending detection); each has a corresponding `.test.ts`

### Backend (`src-tauri/src/`)

All Tauri commands are registered in `lib.rs` via `invoke_handler`. Modules:

- `auth/` — GitHub Device Flow OAuth (`device_flow.rs`) + Stronghold-encrypted token storage (`token_store.rs`); in-memory `TOKEN_CACHE` avoids repeated snapshot decryption
- `git/` — git operations via the `git2` crate: `status`, `commit`, `push`, `publish` (atomic stage+commit+push), `revert`, `branch`, `clone`
- `fs/` — scoped filesystem access restricted to repo paths (`scoped.rs`); session persistence (`session.rs`)
- `github/` — GitHub REST API for listing repositories
- `preview/` — spawns/stops the Jekyll process, writes temp config overrides, streams logs to `preview.log`

### IPC Contract

Frontend calls `invoke('command_name', { ...args })` through typed wrappers in `src/lib/tauri/`. The Rust handler signatures in `src-tauri/src/` define the contract. When adding a new command, register it in `lib.rs`'s `invoke_handler` list.

### App Flow

1. Auth check (`get_token`) → show `AuthScreen` or proceed
2. Session restore (`load_last_session`) → show `RepoSelector` or reopen last repo
3. Workspace: left sidebar (Files/Search/Git blades) + CodeMirror editor + Preview panel (Instant Markdown or Jekyll iframe)

### Key Design Decisions

- **Publish is atomic**: `git_publish` stages eligible files, commits, and pushes in one IPC call — no separate stage/commit/push steps in the UI
- **Whitespace-only diffs**: classified server-side and hidden from the publish list by default
- **Line endings**: files are saved preserving their original LF/CRLF style to avoid spurious git diffs
- **Jekyll preview**: spawned via login shell (`bash -l -c` / `cmd /C`) so rbenv/rvm PATH is available; auto-retries without `--livereload` if the first attempt fails
- **Token storage**: Stronghold (XChaCha20-Poly1305) at `~/.local/share/com.brendonthiede.hyditor/auth.stronghold`; key lookup order: in-memory cache → OS keychain → `auth.key` backup file

## Auth Setup for Local Dev

The default GitHub OAuth client ID lives in `DEFAULT_CLIENT_ID` in `src-tauri/src/auth/device_flow.rs`. To use a different app locally, copy `.env.example` to `.env` and set `HYDITOR_GITHUB_CLIENT_ID` — `npm run tauri:dev` loads it automatically.

## Tests

Frontend tests are in `src/lib/utils/*.test.ts` and `src/lib/stores/*.test.ts` (Vitest).

Rust tests are inline in `src-tauri/src/auth/token_store.rs`, `src-tauri/src/fs/scoped.rs`, `src-tauri/src/preview/jekyll.rs`, and `src-tauri/src/git/commit.rs`. Token store integration tests share a process-global cache serialized by `INTEGRATION_LOCK`; they are safe with any `--test-threads` value. The `[profile.dev.package."*"] opt-level = 2` setting in `Cargo.toml` keeps Stronghold operations fast in debug builds.

**All tests must pass. Never skip, ignore, or mark tests `#[ignore]` to make the suite pass.**

## Contributor Rules

- README `Implemented` section must be updated as part of every completed feature.
- PR checklist: `npm run check`, `npm run lint`, `npm test`, `cd src-tauri && cargo test`, `npm audit --omit=dev` — all must pass with zero errors.
- CI runs lint, type checks, audit, frontend tests, and Rust tests on Linux and Windows for every push to `main` and every PR.
- Releases are triggered by pushing a semver tag (`git tag vX.Y.Z && git push --tags`) or manually via GitHub Actions.
