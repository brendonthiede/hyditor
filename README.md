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
- Tokens stored in Stronghold encrypted vault (XChaCha20-Poly1305 encryption) at `~/.local/share/com.brendonthiede.hyditor/auth.stronghold`.
- Stronghold unlock material is persisted in the OS keychain (`io.github.brendonthiede.hyditor` / `stronghold-master-key`) and hashed with app context to derive the runtime vault key.
- A `auth.key` backup file (0600 permissions, same directory as the snapshot) holds the raw key material as a fallback for when the OS keychain is unavailable.  Key lookup order: in-memory cache → OS keychain → backup file → (legacy `stronghold.key` migration) → generate fresh key.
- Existing `stronghold.key` entries are migrated to the keychain + backup file on first access and the legacy file is removed.
- Tokens are persisted between app sessions and refreshed automatically before expiry.
- An in-memory `StoredToken` cache (`TOKEN_CACHE`) avoids repeated Stronghold snapshot reads.  The cache is populated on first `get_stored_token` call and invalidated on `set_token` / `sign_out`.  Diagnostic timing logs (`[Stronghold]`, `[Keychain]`) are emitted to stderr on cache-miss paths to aid future profiling.
- If Stronghold snapshot decryption fails (for example due to stale/corrupted local snapshot state), Hyditor removes the corrupt snapshot and shows the sign-in screen without retrying the expensive key-derivation step.

## Next Work

- If a file is only different in whitespace, ignore it in the git status and preview (optional toggle for showing whitespace diffs). Do not allow whitespace-only changes to be staged or committed.
- Add a filter to the file list to hide files that are not relevant to Jekyll sites (e.g. node_modules, vendor, .bundle, etc.) and/or binary files that cannot be previewed (optional toggle for showing all files) and to filter to matching names.
- Manual testing and validation of implemented features with various GitHub accounts, repo configurations, and edge cases (token expiry, revoked tokens, 2FA accounts, large repos, etc.)
- Define next roadmap item
