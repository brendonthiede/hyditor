# Hyditor

<img src="src-tauri/app-icon.png" alt="Hyditor logo" width="128" />

Secure, desktop-native editor and previewer for Jekyll sites on GitHub Pages.

[![CI](https://github.com/brendonthiede/hyditor/actions/workflows/ci.yml/badge.svg)](https://github.com/brendonthiede/hyditor/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/brendonthiede/hyditor)](https://github.com/brendonthiede/hyditor/releases/latest)

## Releases

Pre-built binaries for Linux, Windows, and macOS are attached to every [GitHub Release](https://github.com/brendonthiede/hyditor/releases).

| Platform | Artifacts |
|---|---|
| Linux | `.deb`, `.AppImage`, `.rpm` |
| Windows | `.msi`, `.exe` (NSIS installer) |
| macOS | `.dmg` |

> **macOS builds** are enabled by default. To disable them (e.g. to save GitHub Actions minutes), set the repository variable `ENABLE_MACOS_BUILD` to `false` in **Settings → Secrets and variables → Actions → Variables**.

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
    librsvg2-dev \
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

If `Sign in with GitHub` reports client ID not configured, the `DEFAULT_CLIENT_ID` placeholder in `src-tauri/src/auth/device_flow.rs` has not been replaced yet — see **Auth Implementation Notes** below for how to create an app and fill it in.

To use a different client ID for local development without changing the committed default, copy `.env.example` to `.env` and set `HYDITOR_GITHUB_CLIENT_ID`; `npm run tauri:dev` loads `.env` automatically.

## Developing over SSH (Windows)

Tauri requires a display server. When connecting from Windows via SSH, a forwarded X11 display is needed. The following setup was tested with Windows Terminal + VS Code Remote SSH connecting to a Linux (Mint) dev machine.

### 1. Install VcXsrv on Windows

Download and install [VcXsrv](https://sourceforge.net/projects/vcxsrv/). Launch **XLaunch** with these settings:

- Window mode: **Multiple windows**
- Client: **Start no client**
- Extra settings: check **Disable access control**

Save the config and place the `.xlaunch` file in `shell:startup` so it auto-starts on login.

Example saved config:

```xml
<XLaunch WindowMode="MultiWindow" ClientMode="NoClient" LocalClient="False"
  Display="-1" Clipboard="True" ClipboardPrimary="True" Wgl="True"
  DisableAC="True" XDMCPTerminate="False"/>
```

### 2. Update `~/.ssh/config` on Windows

Add X11 forwarding to the host entry so both Windows Terminal and VS Code Remote SSH use it:

```
Host brendon-mint
    User            brendon
    HostName        192.168.1.48
    IdentityFile    ~/.ssh/id_ed25519
    IdentitiesOnly  yes
    ForwardX11      yes
    ForwardX11Trusted yes
```

### 3. Auto-set `DISPLAY` for VS Code Remote SSH sessions

VS Code Remote SSH does not forward X11 — `$DISPLAY` is empty in the integrated terminal. Add the following to **both** `~/.bashrc` and `~/.profile` on the Linux machine so `DISPLAY` is set automatically from the client IP in `$SSH_CLIENT`:

```bash
# Auto-set DISPLAY for SSH sessions when not already set (e.g. VS Code Remote SSH)
# Requires VcXsrv running on the Windows client with "Disable access control" checked.
if [ -n "$SSH_CLIENT" ] && [ -z "$DISPLAY" ]; then
    export DISPLAY=$(echo "$SSH_CLIENT" | awk '{print $1}'):0
fi
```

Windows Terminal sessions with `-X` forwarding already have `DISPLAY` set by SSH, so this block is a no-op for them.

### 4. Prevent GUI browser launch over X11

When the GitHub Device Flow auth link is clicked, the app calls `xdg-open` which launches Firefox over the forwarded X display. Firefox is too heavy for VcXsrv and will crash it.

Create `~/.local/bin/xdg-open-wrapper` to intercept HTTP/HTTPS URLs:

```bash
#!/bin/bash
# SSH-safe xdg-open wrapper. Intercepts http/https URLs to avoid launching a
# GUI browser over X11 forwarding, which crashes lightweight X servers like VcXsrv.
# The URL is printed to the terminal and saved to /tmp/hyditor-open-url.txt.
URL="$1"
if [[ "$URL" == http://* ]] || [[ "$URL" == https://* ]]; then
    echo "" >&2
    echo "============================================" >&2
    echo "  Open this URL in your Windows browser:  " >&2
    echo "  $URL" >&2
    echo "============================================" >&2
    echo "" >&2
    echo "$URL" > /tmp/hyditor-open-url.txt
    exit 0
fi
exec /usr/bin/xdg-open "$@"
```

```bash
chmod +x ~/.local/bin/xdg-open-wrapper
```

Then add to `~/.profile` to activate it for all SSH sessions:

```bash
# Use lightweight xdg-open wrapper in SSH sessions to avoid launching GUI browser over X11
if [ -n "$SSH_CLIENT" ]; then
    export BROWSER="$HOME/.local/bin/xdg-open-wrapper"
fi
```

### 5. Running the app

For the first terminal in a new session (or always to be safe):

```bash
source ~/.profile
npm run tauri:dev
```

The Hyditor window will appear on the Windows desktop via VcXsrv.

When the auth screen shows a verification link, **do not click it** — the device code is already copied to your clipboard. The terminal will print the URL; open it manually in your Windows browser and paste the code.

## Security Direction

- No tokens persisted in plaintext
- Scoped filesystem commands only
- Tauri capability allowlist + CSP
- Git operations through Rust (git2) command layer

## Implemented (Phase 1)

- ✅ GitHub Device Flow authentication (OAuth App or GitHub App) with token refresh
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
- ✅ Auth persistence: `auth.key` backup key file (0600 permissions) is written alongside the Stronghold snapshot whenever key material is generated; on subsequent startups the key is loaded from keychain first, then backup file if the keychain is unavailable (locked session, missing secret-service, or distro-specific keyring quirks) — fixes the login-every-time issue on systems where the OS keychain silently drops entries between sessions
- ✅ `.git` directory excluded from file tree and scoped filesystem operations (backend `filter_entry` + walkdir skip)
- ✅ Collapsible folder tree in file panel (hierarchical view with toggle chevrons)
- ✅ "Collapse All" button in file tree header collapses all open folders at once; `.github` and `.vscode` directories excluded from file tree (not relevant to Jekyll sites)
- ✅ Full Preview fixed: Jekyll is spawned via `bash -l -c` to pick up rbenv/rvm/system PATH; `bundle install` is run automatically before `bundle exec jekyll serve`; stderr is forwarded to the terminal; early process exit is detected and reported with an actionable message; `--baseurl ""` added to prevent URL routing issues
- ✅ Full Preview deep-link: opening Full Preview navigates the iframe directly to the current Markdown file (posts, draft posts, and regular pages); switching files while in Jekyll mode updates the iframe URL automatically; `--drafts` flag passed to Jekyll so draft posts are served; permalink URL is resolved from the post's front matter (`permalink`, `categories`, `category`, `slug`, `date` overrides) and the site's `_config.yml` `permalink` setting (named presets `date`, `pretty`, `ordinal`, `none` and custom templates all supported)
- ✅ Full Preview loads by default when a repository is opened; "Instant" is available as a toggle for users who prefer faster previews without Jekyll features; toolbar button order updated (Full Preview first)
- ✅ Repository list filter: realtime search by owner/name/description with frontend pagination (20 per page) so users with many repos can quickly find the repo they want
- ✅ Preview viewport scrollbars: the preview canvas scrolls when the selected viewport (Desktop/Tablet/Mobile) is larger than the panel, preserving the exact chosen width/height so responsive breakpoints are rendered correctly
- ✅ Editor scrollbar: vertical scrollbar enabled on the CodeMirror scroller (`overflow-y: auto`); horizontal scroll suppressed while word-wrap is on (`overflow-x: hidden`) — comment in source notes where to update this when a word-wrap toggle is added
- ✅ "Open another repository" button in the toolbar header clears all repo/editor/git state and returns to the repository selection screen
- ✅ Resizable, collapsible panels: drag the divider between any two panels to resize; click the collapse arrow in the FileTree/GitPanel header (or the collapsed strip) to toggle each panel; the preview panel adds position-toggle (side-by-side ↔ below editor) and fullscreen overlay (Escape to exit) buttons in its toolbar; layout sizes and collapsed state are persisted to `localStorage` across sessions
- ✅ Preview pop-out window: a "Pop Out" button in the preview toolbar opens the preview in a native Tauri `WebviewWindow` (ideal for second-monitor use); Jekyll mode opens the Jekyll dev server URL directly in the new window; Instant mode loads a standalone `/preview-window` route and receives live HTML updates via Tauri events as the user edits; closing the pop-out window (OS close button or toolbar "Close" button) automatically resets the pop-out state
- ✅ Whitespace-only change detection: files whose working-tree diff (index → workdir) is entirely whitespace are marked `whitespace_only` in the backend; they are hidden from the Unstaged list by default and cannot be staged or committed; a "Show whitespace (N)" toggle in the Unstaged header reveals them (greyed out, checkboxes disabled) for reference; the backend `git_stage` command also rejects any staging attempt for whitespace-only files as a safety net
- ✅ File tree filtering: a text input filters visible files by name (matching files and their ancestor directories are shown, all directories auto-expand while a query is active); a toggle button (`🔽` / `👁`) hides or reveals Jekyll-irrelevant directories (`node_modules`, `vendor`, `.bundle`, `_site`, `.sass-cache`, `.jekyll-cache`, `.jekyll-metadata`) and binary files (images, fonts, archives, etc.) — enabled by default with a "show all" notice showing the count of hidden items
- ✅ Text search blade: the left panel has a blade toggle — **Files** (file tree) and **Search** (content search); the Search blade provides a debounced full-text search across all text files in the repo (`search_repo_files` Rust command); results are grouped by file with collapsible file groups (expand/collapse all buttons), per-match line numbers, inline keyword highlighting, and a match count badge per file; clicking any match opens that file in the editor; results are capped at 500 total matches to keep the UI responsive; binary files, files over 1 MiB, and `.git`/`.github`/`.vscode` directories are excluded
- ✅ Git panel moved into the left sidebar: the blade toggle now has three tabs — **Files**, **Search**, and **Git** — replacing the separate right-side Git panel; clicking the Git badge in the toolbar expands the left panel and switches to the Git blade
- ✅ Repo filter autofocus: when the repository selection screen opens, the filter input is automatically focused so the user can start typing immediately without clicking it first
- ✅ "Copy repo path" button in the toolbar copies the local cache path of the active repository to the clipboard; the button briefly shows "Path copied!" as feedback, and its tooltip always shows the full path — lets users jump directly to the repo in their preferred code editor or terminal
- ✅ Preview viewport active indicator: the currently selected viewport preset button (Desktop / Tablet / Mobile) is highlighted with the active style so users can see which size is selected at a glance
- ✅ Jekyll preview file navigation: the preview iframe is wrapped in a `{#key}` block so clicking a different file in the file tree always navigates to the correct post/draft page — fixes a regression where the iframe `src` attribute update did not trigger navigation in WebKit

## Contributor Workflow

- README updates are required as part of "done" for every completed feature, architecture change, or workflow change.
- Update both sections when relevant:
  - `Implemented (Phase 1)` (or the current implementation section) with completed deliverables.
  - `Next Work` by removing completed items and adding/refining upcoming work.
- If commands, prerequisites, or test workflows change, update `Quick Start` and `Tests` in the same PR.

## CI / Releases

The `ci` workflow runs on every push to `main` and every pull request, executing lint, type checks, dependency audit, frontend unit tests, and Rust tests on both Linux and Windows.

The `release` workflow is triggered by pushing a semver tag (e.g. `git tag v0.1.1 && git push --tags`) or manually via **Actions → Release → Run workflow** (provide the version without the `v` prefix). It re-runs all CI checks, then builds native binaries for Linux, Windows, and macOS in parallel and attaches them to a **draft** GitHub Release pre-populated with auto-generated release notes. Review the draft and publish when ready.

Release notes are categorized by PR label using [`.github/release.yml`](.github/release.yml). Labels: `breaking`, `enhancement`/`feature`, `bug`/`fix`, `documentation`/`docs`, `maintenance`/`dependencies`/`chore`. Any PR not matching a label appears under "Other Changes".

The `ENABLE_MACOS_BUILD` repository variable controls whether the macOS build job runs (default: enabled). Set it to `false` in **Settings → Secrets and variables → Actions → Variables** to skip macOS builds.

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

- The Device Flow `client_id` is public and safe to embed (it appears in plaintext in every OAuth HTTP request).
- The real client ID is committed directly in `DEFAULT_CLIENT_ID` in `src-tauri/src/auth/device_flow.rs`. No build secrets or env vars are needed for release builds.
- The runtime env var `HYDITOR_GITHUB_CLIENT_ID` or `.env` file overrides the compiled-in value, useful for local dev with a separate dev app.
- **Both OAuth Apps and GitHub Apps work** with Device Flow. Choose one:
  - **OAuth App** (simpler): Settings → Developer settings → OAuth Apps → New OAuth App. Set Homepage URL, check **Enable Device Flow**. Client ID is a 20-char hex string.
  - **GitHub App** (more granular permissions): Settings → Developer settings → GitHub Apps → New GitHub App. Set name + homepage, check **Enable Device Flow** under "Identifying and authorizing users", disable Webhook. Set Repository permissions → Contents: Read & write + Metadata: Read-only; Account permissions → Email addresses: Read-only. Client ID starts with `Iv1.`.
- After creating either app type, copy the **Client ID** from the app settings page into `DEFAULT_CLIENT_ID` in `device_flow.rs` and commit.
- You may reuse the same app for development and releases. To use a separate dev app, set `HYDITOR_GITHUB_CLIENT_ID` in `.env` to override the committed default.
- Tokens stored in Stronghold encrypted vault (XChaCha20-Poly1305 encryption) at `~/.local/share/com.brendonthiede.hyditor/auth.stronghold`.
- Stronghold unlock material is persisted in the OS keychain (`io.github.brendonthiede.hyditor` / `stronghold-master-key`) and hashed with app context to derive the runtime vault key.
- A `auth.key` backup file (0600 permissions, same directory as the snapshot) holds the raw key material as a fallback for when the OS keychain is unavailable.  Key lookup order: in-memory cache → OS keychain → backup file → (legacy `stronghold.key` migration) → generate fresh key.
- Existing `stronghold.key` entries are migrated to the keychain + backup file on first access and the legacy file is removed.
- Tokens are persisted between app sessions and refreshed automatically before expiry.
- An in-memory `StoredToken` cache (`TOKEN_CACHE`) avoids repeated Stronghold snapshot reads.  The cache is populated on first `get_stored_token` call and invalidated on `set_token` / `sign_out`.  Diagnostic timing logs (`[Stronghold]`, `[Keychain]`) are emitted to stderr on cache-miss paths to aid future profiling.
- If Stronghold snapshot decryption fails (for example due to stale/corrupted local snapshot state), Hyditor removes the corrupt snapshot and shows the sign-in screen without retrying the expensive key-derivation step.

## App Icon

The source icon is `src-tauri/app-icon.png` — a square, transparent-background PNG at 1024×1024 px.

All platform icons in `src-tauri/icons/` are generated from it and should never be edited manually. To regenerate after updating the source:

```bash
npx tauri icon src-tauri/app-icon.png
```

Generated outputs:

| File(s) | Platform |
|---|---|
| `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png` | Linux |
| `icon.icns` | macOS |
| `icon.ico` | Windows (embeds 16/32/48/256 px layers) |
| `Square*Logo.png`, `StoreLogo.png` | Windows MSIX/Store |
| `icons/android/`, `icons/ios/` | Mobile (future targets) |

For in-app UI use (e.g. the auth screen), place SVG or PNG assets under `src/lib/assets/` and import them directly in Svelte components.

## Next Work

- The file tree filter for jekyll-relevant files should hide _includes, _layouts, and _sass directories. Under the assets folder, the js, css, and scss should be hidden, but everything else should be shown (currently some images are hidden, but they should be shown).
- Add a mechanism to add images to the editor content and upload them to the repo (e.g. drag-and-drop into the editor, or an "Insert image" button that opens a file picker). This is a common workflow for blog posts and would be a valuable addition to the editor.
- Define next roadmap item
