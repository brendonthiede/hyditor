# Hyditor

Secure, desktop-native editor and previewer for Jekyll sites on GitHub Pages.

## Status

This repository currently contains the **Phase 1 foundation scaffold**:

- Tauri v2 backend structure in `src-tauri/`
- SvelteKit + TypeScript frontend structure in `src/`
- Initial IPC command contracts for auth, repos, git, preview, and scoped filesystem
- Baseline app layout (auth/repo/editor/preview/git panel placeholders)

## Quick Start

Prerequisites:

- Node.js 20+
- Rust stable (rustc + cargo)
- Tauri prerequisites for your OS

Linux system dependencies (for Tauri + GTK):

```bash
sudo apt update
sudo apt install -y \
    pkg-config \
    libgtk-3-dev \
    libglib2.0-dev \
    libgdk-pixbuf2.0-dev \
    libpango1.0-dev \
    libcairo2-dev \
    libatk1.0-dev \
    libgirepository1.0-dev \
    libjavascriptcoregtk-4.1-dev \
    libsoup-3.0-dev \
    libwebkit2gtk-4.1-dev
```

Rust setup (recommended):

- Install via rustup: <https://rustup.rs>
- Verify the toolchain is available:

```bash
rustc --version
cargo --version
```

If either command fails, ensure your shell PATH includes the Rust toolchain (rustup prints the fix during install).

Install and run:

```bash
npm install
npm run tauri:dev
```

If `Sign in with GitHub` reports client ID not configured, copy `.env.example` to `.env` and set `HYDITOR_GITHUB_CLIENT_ID` to your GitHub App public client ID. `npm run tauri:dev` loads `.env` automatically.

Note: The Device Flow `client_id` is public (not a secret). `HYDITOR_GITHUB_CLIENT_ID` overrides the embedded value for development.

## Security Direction

- No tokens persisted in plaintext
- Scoped filesystem commands only
- Tauri capability allowlist + CSP
- Git operations through Rust (git2) command layer

## Implemented (Phase 1)

- ✅ GitHub App Device Flow authentication with token refresh
- ✅ Stronghold-backed encrypted token storage with OS keychain-backed key derivation
- ✅ Authenticated GitHub repository listing + clone-to-cache flow (git2)
- ✅ CodeMirror 6 editor with language switching (Markdown, YAML, HTML/Liquid)
- ✅ Hybrid preview pipeline (instant Markdown render + Jekyll iframe toggle)
- ✅ Front matter display in instant preview header
- ✅ Responsive viewport simulation (Desktop/Tablet/Mobile presets)
- ✅ Debounced editor autosave to scoped filesystem
- ✅ Git status, staging, commit, and push UI with file selectors
- ✅ Branch management UI (list/switch/create) with local checkout refresh
- ✅ Pull request workflow UI (list/create) backed by GitHub API commands
- ✅ FrontMatterForm structured editor with add/edit/remove field workflow (Phase 3)
- ✅ Security hardening: explicit local sign-out + revocation guidance UX for refresh-token invalidation edge cases
- ✅ Security hardening: proactive expired-token detection in GitHub/repo workflows with guided re-auth prompts
- ✅ Auth resilience: device verification links open via system browser integration and corrupted Stronghold snapshot recovery auto-resets local auth state
- ✅ Auth UX: `Sign in with GitHub` copies the device code to clipboard; user clicks the verification link to open the browser
- ✅ Performance: in-memory token cache eliminates repeated `Stronghold::new()` calls (snapshot decrypt + key derivation) on every `get_token`/`get_access_token` invocation; `get_token` double-open bug fixed
- ✅ Performance: backend-managed device flow polling loop (`start_device_polling`) eliminates per-poll IPC round-trips and redundant `getToken()` verification; status updates emitted via Tauri events (`auth-poll-status`)
- ✅ Performance: startup `get_token` skips Stronghold when no snapshot file exists (or snapshot is zero-bytes/corrupt); corrupted snapshots are removed without retrying the expensive key-derivation; all HTTP clients use 15-second timeouts to prevent indefinite hangs during token refresh
- ✅ Performance: `[profile.dev.package."*"] opt-level = 2` in Cargo.toml compiles all dependency crates with optimizations even in debug builds — reduces Stronghold operations (Argon2 key derivation + XChaCha20-Poly1305 save) from ~48 s to ~1 s; all 20 token_store integration tests now run in the default `cargo test` suite (no longer `#[ignore]`d)
- ✅ Auth UX: per-second countdown timer between polls shows "Waiting for authorization — next check in Ns" instead of raw API status strings
- ✅ `.git` directory excluded from file tree and scoped filesystem operations (backend `filter_entry` + walkdir skip)
- ✅ Collapsible folder tree in file panel (hierarchical view with toggle chevrons)
- ✅ Full Preview fixed: Jekyll is spawned via `bash -l -c` to pick up rbenv/rvm/system PATH; `bundle install` is run automatically before `bundle exec jekyll serve`; stderr is forwarded to the terminal; early process exit is detected and reported with an actionable message; `--baseurl ""` added to prevent URL routing issues
- ✅ Full Preview deep-link: opening Full Preview navigates the iframe directly to the current Markdown file (posts, draft posts, and regular pages); switching files while in Jekyll mode updates the iframe URL automatically; `--drafts` flag passed to Jekyll so draft posts are served; permalink URL is resolved from the post's front matter (`permalink`, `categories`, `category`, `slug`, `date` overrides) and the site's `_config.yml` `permalink` setting (named presets `date`, `pretty`, `ordinal`, `none` and custom templates all supported)

## Contributor Workflow

- README updates are required as part of "done" for every completed feature, architecture change, or workflow change.
- Update both sections when relevant:
  - `Implemented (Phase 1)` (or the current implementation section) with completed deliverables.
  - `Next Work` by removing completed items and adding/refining upcoming work.
- If commands, prerequisites, or test workflows change, update `Quick Start` and `Tests` in the same PR.

## PR Checklist

Use this checklist in every PR description:

- [ ] Feature/status docs updated in README (`Implemented` + `Next Work` as needed).
- [ ] Any command, setup, or test workflow changes reflected in README (`Quick Start` / `Tests`).
- [ ] Frontend validation run (`npm run check`, `npm run lint`, `npm test`).
- [ ] Backend validation run (`cd src-tauri && cargo test`).
- [ ] `npm audit --omit=dev` reviewed for production-impacting vulnerabilities.

## Tests

Frontend (Vitest):

- src/lib/utils/authErrors.test.ts
- src/lib/utils/markdown.test.ts
- src/lib/utils/frontmatter.test.ts
- src/lib/utils/jekyll.test.ts

Backend (Rust unit tests):

- src-tauri/src/fs/scoped.rs
- src-tauri/src/preview/jekyll.rs
- src-tauri/src/auth/token_store.rs
- src-tauri/src/auth/device_flow.rs

Run all tests:

```bash
npm test
cd src-tauri && cargo test
```

Note: Run the Rust tests from the `src-tauri` directory.

Ignored Rust tests:

- All `src-tauri/src/auth/token_store.rs` integration tests run by default (the `[profile.dev.package."*"] opt-level = 2` Cargo profile override keeps Stronghold operations under ~2 s).
- Run the full Rust suite:

```bash
cd src-tauri && cargo test -- --test-threads=1
```

## Auth Implementation Notes

- The GitHub Device Flow `client_id` is public and safe to embed.
- `HYDITOR_GITHUB_CLIENT_ID` overrides the embedded value for development.
  - Copy `.env.example` to `.env` and fill in the value; `.env` is loaded automatically by `npm run tauri:dev` via `dotenv-cli`.
- Tokens stored in Stronghold encrypted vault (XChaCha20-Poly1305 encryption) at `~/.local/share/hyditor/auth.stronghold`.
- Stronghold unlock material is persisted in the OS keychain (`io.github.brendonthiede.hyditor` / `stronghold-master-key`) and hashed with app context to derive the runtime vault key.
- Existing `~/.local/share/hyditor/stronghold.key` entries are migrated to the keychain on first access and the local key file is removed.
- Tokens are persisted between app sessions and refreshed automatically before expiry.
- An in-memory `StoredToken` cache (`TOKEN_CACHE`) avoids repeated Stronghold snapshot reads.  The cache is populated on first `get_stored_token` call and invalidated on `set_token` / `sign_out`.  Diagnostic timing logs (`[Stronghold]`) are emitted to stderr on cache-miss paths to aid future profiling.
- If Stronghold snapshot decryption fails (for example due to stale/corrupted local snapshot state), Hyditor removes the corrupt snapshot and shows the sign-in screen without retrying the expensive key-derivation step.

## Next Work

- When opening the full preview, jump to the current file in the preview if it is a Markdown file (e.g. open `http://localhost:4000/current-file.md` instead of `http://localhost:4000/`). This should include draft posts that are not published yet.
- Explore options for not having to login every time that the application starts up. Currently I need to login every time I start the application, which is a bit of a pain.
- Add a filter for the repository list to handle users with many repos (search + pagination + realtime filtering).
- When showing the preview, have scrollbars to ensure that the window is the selected size, but the user can scroll to see the full preview if it is larger than the window, in order to make sure the reactive layout is preserved.
- If a file is only different in whitespace, ignore it in the git status and preview (optional toggle for showing whitespace diffs). Do not allow whitespace-only changes to be staged or committed.
- Add a filter to the file list to hide files that are not relevant to Jekyll sites (e.g. node_modules, vendor, .bundle, etc.) and/or binary files that cannot be previewed (optional toggle for showing all files) and to filter to matching names.
- Manual testing and validation of implemented features with various GitHub accounts, repo configurations, and edge cases (token expiry, revoked tokens, 2FA accounts, large repos, etc.)
- Define next roadmap item
