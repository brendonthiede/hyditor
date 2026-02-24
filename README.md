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

**Optional:** To use a custom GitHub App for development, set `HYDITOR_GITHUB_CLIENT_ID` environment variable with your app's public client ID before running.

Note: The app embeds a public `client_id` for Device Flow. This is not a secret and can be overridden for development.

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

- `src-tauri/src/auth/token_store.rs` contains Stronghold integration-style tests marked `#[ignore]`.
- They are excluded from default `cargo test` runs to avoid environment-sensitive failures in normal dev/CI loops.
- Run them explicitly when validating auth vault behavior:

```bash
cd src-tauri && cargo test auth::token_store -- --ignored
```

## Auth Implementation Notes

- The GitHub Device Flow `client_id` is public and safe to embed.
- `HYDITOR_GITHUB_CLIENT_ID` overrides the embedded value for development.
- Tokens stored in Stronghold encrypted vault (XChaCha20-Poly1305 encryption) at `~/.local/share/hyditor/auth.stronghold`.
- Stronghold unlock material is persisted in the OS keychain (`io.github.brendonthiede.hyditor` / `stronghold-master-key`) and hashed with app context to derive the runtime vault key.
- Existing `~/.local/share/hyditor/stronghold.key` entries are migrated to the keychain on first access and the local key file is removed.
- Tokens are persisted between app sessions and refreshed automatically before expiry.

## Next Work

- Security hardening: add proactive expired-token detection in GitHub/repo workflows with guided re-auth prompts
