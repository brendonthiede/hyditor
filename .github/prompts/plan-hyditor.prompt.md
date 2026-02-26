# Hyditor — Implementation Plan

> A secure, desktop-native editor and previewer for Jekyll sites on GitHub Pages.

## TL;DR

Hyditor is a **Tauri v2** desktop application (Rust backend + SvelteKit frontend) that lets users clone, edit, preview, and push Jekyll sites hosted on GitHub Pages. It provides a **CodeMirror 6** editor with YAML front matter support, a **hybrid preview** system (instant client-side Markdown rendering + full local Jekyll builds), and **responsive viewport simulation** for desktop/tablet/mobile. Authentication uses the **GitHub App Device Flow** for maximum security — no secrets embedded in the binary, fine-grained per-repo permissions, and short-lived tokens stored in the OS keychain via `tauri-plugin-stronghold`. Changes are committed and pushed via **git2** (Rust libgit2 binding, no subprocess spawning) using a streamlined one-click "Publish" workflow. Users who need PR flows or feature branches handle them through GitHub directly.

**License:** GPLv3 (already committed)
**Target platforms:** Linux, macOS, Windows

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Tauri Shell                     │
│  ┌───────────────────────────────────────────┐   │
│  │           SvelteKit Frontend              │   │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐  │   │
│  │  │CodeMirror│ │ Preview   │ │ Publish  │  │   │
│  │  │ Editor   │ │ Viewport  │ │  Panel   │  │   │
│  │  └────┬─────┘ └─────┬─────┘ └────┬─────┘  │   │
│  │       │ IPC         │ IPC        │ IPC    │   │
│  └───────┼─────────────┼────────────┼────────┘   │
│  ┌───────┴─────────────┴────────────┴────────┐   │
│  │            Tauri Rust Core                │   │
│  │  ┌──────────┐ ┌───────────┐ ┌──────────┐  │   │
│  │  │ git2     │ │ Jekyll    │ │ GitHub   │  │   │
│  │  │ (libgit2)│ │ Subprocess│ │ API      │  │   │
│  │  └──────────┘ └───────────┘ └──────────┘  │   │
│  │  ┌──────────────────────────────────────┐ │   │
│  │  │ Stronghold (encrypted token vault)   │ │   │
│  │  └──────────────────────────────────────┘ │   │
│  └───────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### Core Components

| Component | Technology | Role |
|-----------|-----------|------|
| **App shell** | Tauri v2 | Window management, IPC, security sandbox, OS integration |
| **Frontend** | SvelteKit + TypeScript | UI rendering, editor, preview viewport, state management |
| **Code editor** | CodeMirror 6 | Markdown/YAML/Liquid editing with syntax highlighting |
| **Git operations** | `git2` crate (Rust) | Clone, stage, commit, branch, push, pull — no shell subprocess |
| **GitHub API** | `octocrab` crate (Rust) | List repos, check statuses |
| **Auth** | GitHub App Device Flow | OAuth token acquisition, refresh, and revocation |
| **Token storage** | `tauri-plugin-stronghold` | Encrypted credential vault backed by OS keychain |
| **Instant preview** | `remark` + `rehype` + `gray-matter` (JS) | Client-side Markdown/front matter rendering |
| **Full preview** | Jekyll subprocess (local Ruby) | Exact GitHub Pages fidelity via `bundle exec jekyll serve` |
| **Responsive preview** | Resizable `<iframe>` | Viewport presets: Desktop (1440px), Tablet (768px), Mobile (375px) |

---

## Security Model

Security is the top priority. Every design decision is evaluated through this lens.

### Authentication

1. **GitHub App with Device Flow (RFC 8628)**
   - User opens Hyditor → clicks "Sign in with GitHub"
   - App shows a one-time code and opens `https://github.com/login/device` in default browser
   - User enters code, authorizes the Hyditor GitHub App
   - App polls `POST https://github.com/login/oauth/access_token` with `device_code`
   - On success, receives `access_token` + `refresh_token`
  - **No client secret is embedded in the binary** (device flow does not require it)
  - The public `client_id` is safe to embed and can be overridden via `HYDITOR_GITHUB_CLIENT_ID` for development
   - Token has fine-grained permissions: `contents:write`, `metadata:read`
   - User selects which repositories to grant access to during App installation

2. **Token lifecycle**
   - Access tokens expire (configurable, default 8 hours)
   - Refresh tokens rotate on each use (GitHub's refresh token rotation)
   - On token expiry, silently refresh; if refresh fails, prompt re-authentication
   - On sign-out, revoke token via `DELETE /applications/{client_id}/token`

3. **Token storage**
  - Phase 1 uses in-memory storage with expiry checks and refresh; Stronghold integration follows
  - Stored in `tauri-plugin-stronghold` encrypted vault (XChaCha20-Poly1305)
   - Vault is unlocked with a key derived from the OS keychain entry
   - Tokens are never written to disk in plaintext, never in config files, never in localStorage
   - Memory is zeroed after use where possible (Rust's `zeroize` crate)

### IPC Security (Tauri)

- All Tauri commands are explicitly allowlisted in `capabilities` configuration
- Frontend cannot access filesystem, network, or shell directly
- Each IPC command has a defined scope (e.g., filesystem access limited to the cloned repo directory)
- Content Security Policy (CSP) blocks inline scripts, restricts `connect-src` to GitHub API domains
- Tauri's isolation pattern enabled: IPC messages pass through a secure intermediary

### Code Execution Safety

- `git2` (Rust libgit2) for all git operations — no `child_process`, no shell injection vectors
- Jekyll build subprocess is the only shell execution point:
  - Runs in a sandboxed working directory
  - Arguments are hardcoded (`bundle exec jekyll serve --port <random> --no-watch`)
  - No user-supplied strings passed to shell
  - Process is killed on window close or timeout
- GitHub API calls via `octocrab` — typed Rust HTTP client, no raw string interpolation

### Supply Chain

- Audit Cargo dependencies with `cargo audit`
- Audit npm dependencies with `npm audit`
- Pin dependency versions in lockfiles
- CI checks for known vulnerabilities on every PR
- GPLv3 ensures all dependencies must be compatible open-source licenses

---

## Features & Implementation Steps

### Phase 1: Foundation (MVP)

> Goal: Clone a Jekyll repo, edit files, preview in Markdown, commit and push.

**Step 1: Project scaffolding**
- Initialize Tauri v2 project with SvelteKit frontend template: `npm create tauri-app@latest -- --template sveltekit-ts`
- Configure `tauri.conf.json`: window title "Hyditor", default size 1400×900, CSP policy
- Set up `src-tauri/Cargo.toml` with dependencies: `git2`, `octocrab`, `serde`, `tokio`, `tauri-plugin-stronghold`
- Set up frontend `package.json` with: `codemirror`, `@codemirror/lang-markdown`, `@codemirror/lang-yaml`, `gray-matter`, `remark`, `rehype`, `svelte`
- Configure ESLint, Prettier, Rust `clippy` and `rustfmt`

**Step 2: GitHub App registration & Device Flow auth**
- Register a GitHub App at `github.com/settings/apps`:
  - Name: "Hyditor"
  - Permissions: Repository contents (read/write), Metadata (read)
  - Enable Device Flow
  - No webhook URL needed
  - Document the `client_id` (public, safe to embed)
- Implement Rust Tauri command `auth::start_device_flow()`:
  - `POST https://github.com/login/device/code` with `client_id` and `scope`
  - Return `{ verification_uri, user_code, device_code, interval }` to frontend
- Implement Rust Tauri command `auth::poll_for_token(device_code)`:
  - Poll `POST https://github.com/login/oauth/access_token` at specified interval
  - Handle `authorization_pending`, `slow_down`, `expired_token`, `access_denied` responses
  - On success, store token (Phase 1: in-memory; later: Stronghold), return success to frontend
- Implement Rust Tauri command `auth::get_token()`:
  - Read from storage, check expiry, refresh if needed, return token
- Implement Rust Tauri command `auth::sign_out()`:
  - Revoke token via GitHub API, clear Stronghold entry
- Frontend: Auth screen with "Sign in with GitHub" button, user code display, and polling status

**Step 3: Repository selection & cloning**
- Implement Rust command `repos::list_repos(token)`:
  - Use `octocrab` to list repositories accessible to the GitHub App installation
  - Filter for repos with GitHub Pages enabled (or any Jekyll repo)
  - Return `Vec<RepoInfo>` with name, owner, default branch, description
- Implement Rust command `repos::clone_repo(owner, name, path)`:
  - Use `git2::Repository::clone()` with token-based HTTPS auth
  - Clone to `$CACHE_DIR/hyditor/repos/{owner}/{name}/`
  - Support shallow clone (`--depth 1`) for faster initial load
  - If already cloned, do `git pull --ff-only` instead
- Frontend: Repository picker with search/filter, clone progress bar

**Step 4: File tree & editor**
- Implement Rust command `fs::read_tree(repo_path)`:
  - Walk the repo directory, return tree structure
  - Highlight Jekyll-specific directories: `_posts/`, `_drafts/`, `_layouts/`, `_includes/`, `_data/`, `_config.yml`
  - Respect `.gitignore` (skip `_site/`, `.jekyll-cache/`, etc.)
- Implement Rust command `fs::read_file(path)` and `fs::write_file(path, content)`:
  - Scoped to the cloned repo directory only (security: no path traversal)
  - Validate path is within repo root
- Frontend: Sidebar file tree (collapsible, with Jekyll-aware icons)
- Frontend: CodeMirror 6 editor panel
  - Markdown mode for `.md` files with YAML front matter detection
  - YAML mode for `_config.yml` and `_data/*.yml`
  - HTML + Liquid mode for `_layouts/` and `_includes/`
  - Auto-save to local filesystem on edit (debounced, 500ms)

**Step 5: Instant Markdown preview**
- Frontend: Preview panel (split view, side-by-side with editor)
- Parse file with `gray-matter` to separate front matter from body
- Render Markdown body with `remark` → `rehype` → HTML
- Display front matter fields in a header bar above preview
- Apply a basic Jekyll-like stylesheet (based on GitHub Pages default themes: minima, etc.)
- Live update on every keystroke (debounced 200ms)

**Step 6: Git status, staging & commit**
- Implement Rust command `git::status(repo_path)`:
  - Use `git2` to get working directory status (modified, added, deleted, untracked)
  - Return list of changed files with diff summaries
- Implement Rust command `git::diff_file(repo_path, file_path)`:
  - Return unified diff for a single file
- Implement Rust command `git::commit(repo_path, message, files)`:
  - Stage specified files via `git2::Index`
  - Create commit on current branch
  - Sign commits if user has configured GPG key (optional)
- Implement Rust command `git::push(repo_path)`:
  - Push current branch to origin using token-based HTTPS auth
  - Handle push rejection (diverged history) with clear error message
- Frontend: Git panel showing changed files with diffs
  - Checkbox per file to select for staging
  - Commit message input with conventional commit hints
  - "Push to main" button with confirmation dialog
  - Clear status indicators: staged, unstaged, pushed

### Phase 2: Simplified Publish Workflow & Full Preview

> Goal: Streamlined one-click publish, branch persistence, and full Jekyll preview.

**Step 7: Simplified publish panel**
- Remove the separate staged/unstaged file sections from GitPanel
- Show all changed files in a flat list with per-file controls:
  - "Revert" button with confirmation dialog — calls new `git_discard_file` Rust command
  - ⛔ "Do not publish" toggle — local UI state (`Set<string>`), not git staging
- Replace the commit message textarea with "Change notes (optional)"
- Replace separate Commit + Push buttons with a single "Publish" button that:
  - Stages all files not marked ⛔
  - Commits with user's change notes or auto-generated message: "Changes made using Hyditor on M/D/YYYY"
  - Pushes to the current branch immediately
- Auto-refresh git status on panel mount (no manual Refresh button)
- Implement Rust command `git::discard_file(repo_path, file_path)`:
  - For tracked files: `reset_default` + `checkout_head` with `CheckoutBuilder::path().force()`
  - For untracked files: `std::fs::remove_file()`

**Step 8: Branch persistence & cleanup**
- Rename `default_branch` to `last_branch` in `LastSession` struct (Rust + TypeScript)
- Save current branch on: branch switch, file open, repo select
- Restore last-used branch on session reload via `switchBranch()`
- Graceful fallback to default branch if the persisted branch no longer exists
- Remove PR & branch creation UI:
  - ~~Delete `PRDialog.svelte` component and all references from `+page.svelte`~~ ✅
  - ~~Remove Rust backend: `pull_request.rs`~~ ✅ — removed `create_pr`, `list_prs` Tauri commands
  - ~~Remove frontend: `pullRequestState` store, PR-related store functions~~ ✅
  - ~~Remove Tauri wrappers: `listPullRequests()`, `createPullRequest()`~~ ✅
  - Simplify `BranchSelector.svelte`: keep only the branch `<select>` dropdown (remove "Create Branch" input/button and "Refresh" button)
  - Remove Rust backend: `create_branch` function, `git_unstage` command
  - Remove frontend: `branchUiState` store, `createRepoBranch` store function
  - Remove Tauri wrappers: `unstage()`, `createBranch()`
  - Clean up toolbar: remove git badge staged/unstaged distinction; show total changed file count instead

**Step 9: Full Jekyll preview**
- Implement Rust command `preview::start_jekyll(repo_path)`:
  - Check if `ruby` and `bundler` are available on PATH
  - If not, show a helpful error with installation instructions
  - Run `bundle install` if `Gemfile.lock` is missing
  - Spawn `bundle exec jekyll serve --port <random_high_port> --livereload --drafts`
  - Return the server URL (e.g., `http://127.0.0.1:48392`)
  - Track subprocess PID for cleanup
- Implement Rust command `preview::stop_jekyll()`:
  - Kill the Jekyll subprocess and free the port
- Frontend: "Full Preview" toggle button in preview panel
  - When enabled, load Jekyll server URL in the preview iframe instead of client-side render
  - Show a loading spinner during Jekyll build
  - Show build errors (from Jekyll stderr) inline
  - Auto-restart Jekyll on `_config.yml` changes

**Step 10: Responsive viewport simulation**
- Frontend: Viewport toolbar above the preview panel
  - Preset buttons: Desktop (1440px), Tablet (768px), Mobile (375px)
  - Custom width/height input
  - Device frame mockups (optional, nice-to-have)
- Preview iframe resizes to selected dimensions
- Wrap iframe content with appropriate `<meta name="viewport">` tag
- Show current dimensions as a label

### Phase 3: Polish & Advanced Features

> Goal: Quality of life improvements, error handling, robustness.

**Step 11: Front matter form editor**
- For Markdown files, show a structured form above the editor:
  - `title`: text input
  - `date`: date picker (for posts)
  - `layout`: dropdown (populated from `_layouts/` directory)
  - `categories` / `tags`: tag input with autocomplete (from existing posts)
  - `permalink`: text input with preview of resolved URL
  - `published`: toggle (true/false)
  - Custom fields: key-value editor
- Form changes sync bidirectionally with YAML source in editor
- Toggle between form view and raw YAML view

**Step 12: Draft management**
- Sidebar section for `_drafts/`
- "Publish Draft" action: moves file from `_drafts/` to `_posts/`, prepends date
- "Unpublish Post" action: moves from `_posts/` to `_drafts/`, strips date
- "New Post" wizard: prompts for title, generates filename (`YYYY-MM-DD-slugified-title.md`), creates front matter template

**Step 13: Image & asset management**
- Drag-and-drop image upload into editor
- Image saved to `assets/images/` (configurable path)
- Markdown image tag auto-inserted at cursor: `![alt]({{ site.baseurl }}/assets/images/filename.png)`
- Image preview in the sidebar
- Warn about large files (>5MB) before commit

**Step 14: Conflict resolution**
- Before push, check if remote has newer commits
- If diverged, show a clear dialog:
  - "Remote has changed since you last pulled"
  - Options: "Pull & Rebase", "Pull & Merge", "Force Push" (with scary warning)
- Show merge conflicts in the editor with markers if they occur
- For simple cases (non-overlapping changes), auto-resolve

**Step 15: Settings & preferences**
- Theme: light/dark/system (stored in Stronghold or local config)
- Editor: font size, tab size, word wrap, line numbers
- Preview: default viewport, default theme
- Git: default commit message template, author name/email
- Jekyll: custom `jekyll serve` arguments, Ruby path override

**Step 16: Offline support**
- Full editing capability when offline (working on local clone)
- Queue commits locally
- Show "offline" indicator
- On reconnect, enable push/pull operations
- Sync status panel showing ahead/behind counts

---

## Project Structure

```
hyditor/
├── src-tauri/                    # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json           # Tauri config, permissions, CSP
│   ├── capabilities/             # Tauri v2 capability definitions
│   │   └── default.json
│   ├── src/
│   │   ├── main.rs               # Tauri app entry point
│   │   ├── lib.rs                # Command registration
│   │   ├── auth/
│   │   │   ├── mod.rs
│   │   │   ├── device_flow.rs    # GitHub Device Flow implementation
│   │   │   └── token_store.rs    # Stronghold-based token storage
│   │   ├── git/
│   │   │   ├── mod.rs
│   │   │   ├── branch.rs         # Branch list & switch
│   │   │   ├── clone.rs          # Repo cloning via git2
│   │   │   ├── commit.rs         # Staging & committing
│   │   │   ├── push.rs           # Push with HTTPS token auth
│   │   │   └── status.rs         # Working directory status & diffs
│   │   ├── github/
│   │   │   ├── mod.rs
│   │   │   └── repos.rs          # List repos, check Pages status
│   │   ├── preview/
│   │   │   ├── mod.rs
│   │   │   └── jekyll.rs         # Jekyll subprocess management
│   │   └── fs/
│   │       ├── mod.rs
│   │       ├── scoped.rs         # Scoped filesystem access
│   │       └── session.rs        # Last-session persistence (repo path, branch)
│   └── icons/                    # App icons
├── src/                          # SvelteKit frontend
│   ├── app.html
│   ├── app.css                   # Global styles, theme variables
│   ├── lib/
│   │   ├── components/
│   │   │   ├── AuthScreen.svelte     # Device flow sign-in
│   │   │   ├── BranchSelector.svelte # Branch switcher (dropdown only)
│   │   │   ├── Editor.svelte         # CodeMirror 6 wrapper
│   │   │   ├── FileTree.svelte       # Sidebar file browser
│   │   │   ├── FrontMatterForm.svelte# Structured front matter editor
│   │   │   ├── GitPanel.svelte       # Changed files list, revert, publish
│   │   │   ├── PanelResizeHandle.svelte # Drag-to-resize divider between panels
│   │   │   ├── Preview.svelte        # Markdown preview + iframe
│   │   │   ├── RepoSelector.svelte   # Repo picker
│   │   │   ├── SearchPanel.svelte    # Full-text search across repo files
│   │   │   └── ViewportToolbar.svelte# Desktop/tablet/mobile presets
│   │   ├── stores/
│   │   │   ├── auth.ts           # Auth state
│   │   │   ├── editor.ts         # Editor state (open files, dirty flags)
│   │   │   ├── editor.test.ts    # Editor store tests
│   │   │   ├── layout.ts         # Panel sizes, collapsed state, persistence
│   │   │   ├── layout.test.ts    # Layout store tests
│   │   │   ├── preview.ts        # Preview mode & viewport state
│   │   │   └── repo.ts           # Active repo state
│   │   ├── tauri/
│   │   │   ├── auth.ts           # IPC wrappers for auth commands
│   │   │   ├── fs.ts             # IPC wrappers for file operations
│   │   │   ├── git.ts            # IPC wrappers for git commands
│   │   │   ├── github.ts         # IPC wrappers for GitHub API commands
│   │   │   ├── preview.ts        # IPC wrappers for Jekyll preview
│   │   │   ├── runtime.ts        # Tauri runtime detection helper
│   │   │   ├── session.ts        # Session save/restore IPC wrappers
│   │   │   └── window.ts         # Window management IPC wrappers
│   │   └── utils/
│   │       ├── authErrors.ts     # Auth-expired error detection
│   │       ├── authErrors.test.ts
│   │       ├── errors.ts         # General error utilities
│   │       ├── errors.test.ts
│   │       ├── frontmatter.ts    # gray-matter parsing helpers
│   │       ├── frontmatter.test.ts
│   │       ├── jekyll.ts         # Jekyll filename conventions, slug generation
│   │       ├── jekyll.test.ts
│   │       ├── markdown.ts       # remark/rehype rendering pipeline
│   │       └── markdown.test.ts
│   └── routes/
│       ├── +layout.svelte        # App shell layout
│       ├── +layout.ts            # SvelteKit layout load (SSR disabled)
│       ├── +page.svelte          # Main editor page
│       └── preview-window/
│           └── +page.svelte      # Pop-out preview window route
├── static/                       # Static assets
├── package.json
├── svelte.config.js
├── tsconfig.json
├── vite.config.ts
├── PLAN.md                       # This file
├── LICENSE                       # GPLv3
├── .gitignore
└── README.md
```

---

## Key Rust Dependencies (`Cargo.toml`)

| Crate | Purpose |
|-------|---------|
| `tauri` (v2) | App framework |
| `tauri-plugin-stronghold` | Encrypted credential storage |
| `tauri-plugin-shell` | Jekyll subprocess (restricted) |
| `git2` | Git operations (libgit2) |
| `octocrab` | GitHub REST API client |
| `serde` / `serde_json` | Serialization for IPC |
| `tokio` | Async runtime |
| `zeroize` | Secure memory cleanup for tokens |
| `reqwest` | HTTP client (for device flow, if not using octocrab) |

## Key Frontend Dependencies (`package.json`)

| Package | Purpose |
|---------|---------|
| `@tauri-apps/api` | Tauri IPC bridge |
| `codemirror` | Code editor core |
| `@codemirror/lang-markdown` | Markdown syntax & editing |
| `@codemirror/lang-yaml` | YAML syntax |
| `@codemirror/lang-html` | HTML/Liquid syntax |
| `@codemirror/theme-one-dark` | Dark theme |
| `gray-matter` | YAML front matter parsing |
| `unified` / `remark-parse` / `remark-rehype` / `rehype-stringify` | Markdown → HTML pipeline |
| `rehype-highlight` | Code block syntax highlighting in preview |

---

## Tauri Security Configuration

### `capabilities/default.json`

```json
{
  "identifier": "default",
  "description": "Default capability for Hyditor",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "stronghold:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        { "name": "jekyll", "cmd": "bundle", "args": ["exec", "jekyll", "serve", { "validator": "\\-\\-port" }, { "validator": "\\d+" }] }
      ]
    },
    {
      "identifier": "fs:allow-read",
      "allow": [{ "path": "$APPDATA/repos/**" }]
    },
    {
      "identifier": "fs:allow-write",
      "allow": [{ "path": "$APPDATA/repos/**" }]
    }
  ]
}
```

### Content Security Policy (in `tauri.conf.json`)

```
default-src 'self';
connect-src 'self' https://api.github.com https://github.com https://127.0.0.1:*;
img-src 'self' data: https:;
style-src 'self' 'unsafe-inline';
script-src 'self';
frame-src 'self' http://127.0.0.1:*;
```

---

## GitHub App Configuration

| Setting | Value |
|---------|-------|
| **App Name** | Hyditor |
| **Homepage URL** | `https://github.com/brendonthiede/hyditor` |
| **Callback URL** | Not needed (device flow) |
| **Setup URL** | Optional: link to README |
| **Webhook** | Disabled (not needed) |
| **Permissions** | Repository: Contents (R/W), Metadata (R) — Pull requests permission removed (PR workflows handled via GitHub directly) |
| **Where can this app be installed?** | Any account |
| **Enable Device Flow** | Yes |

The `client_id` from the registered app is embedded in the binary. This is safe — the device flow does not require a client secret, and the `client_id` alone cannot obtain tokens without user interaction in a browser.

---

## Verification & Testing

### Unit Tests
- **Rust**: Test auth token lifecycle (mock GitHub API), git operations (temp repo), filesystem scoping (path traversal rejection)
- **Frontend**: Test Markdown rendering pipeline, front matter parsing, viewport calculations

### Integration Tests
- Clone a public test repo, make changes, verify git status, commit, and check commit content
- Full Device Flow with a test GitHub App (use `GITHUB_TOKEN` env var to skip interactive flow in CI)
- Jekyll subprocess start/stop lifecycle

### Manual Testing Checklist
- [ ] Sign in via Device Flow on each OS
- [ ] Clone a Jekyll repo
- [ ] Edit a Markdown post, verify instant preview updates
- [ ] Edit front matter via form, verify it syncs to YAML
- [ ] Switch between Desktop/Tablet/Mobile viewport presets
- [ ] Run full Jekyll preview, verify it matches GitHub Pages output
- [ ] Publish changed files with change notes, verify commit + push on GitHub
- [ ] Publish with no change notes, verify auto-generated message format
- [ ] Mark files as "Do not publish", verify they are excluded from the commit
- [ ] Revert a modified file, confirm dialog appears, verify file restored
- [ ] Revert an untracked file, verify file is deleted
- [ ] Switch branches, close app, reopen, verify last branch is restored
- [ ] Persist branch that gets deleted remotely, verify graceful fallback to default
- [ ] Handle push conflict (someone else pushed first)
- [ ] Sign out, verify tokens are revoked and cleared
- [ ] Edit while offline, push when back online

### Security Testing
- [ ] Verify no tokens in logs, config files, or localStorage
- [ ] Verify CSP blocks inline script injection
- [ ] Verify filesystem commands reject paths outside repo root (`../../etc/passwd`)
- [ ] Verify shell commands are restricted to Jekyll only
- [ ] Run `cargo audit` and `npm audit` with zero critical vulnerabilities
- [ ] Verify token auto-expires and refresh works silently

### CI Pipeline (GitHub Actions)
- Lint: `cargo clippy`, `eslint`, `prettier`
- Test: `cargo test`, `npm test`
- Audit: `cargo audit`, `npm audit`
- Build: `tauri build` for Linux, macOS, Windows
- Release: Draft GitHub Release with platform binaries on tag push

### Test Policy (mandatory)
- **All tests must pass.** The full validation suite (`npm run check && npm run lint && npm test` + `cd src-tauri && cargo test`) must complete with zero errors and zero failures before any change is considered done.
- **Never skip, ignore, or disable tests** to make the suite pass. Do not add `#[ignore]`, `skip()`, or conditional gates that bypass tests related to existing code.
- **Never dismiss failures as pre-existing or flaky.** If a test fails intermittently, fix the root cause (add synchronization, isolate shared state, remove race conditions) rather than ignoring the failure or requiring `--test-threads=1`.
- **Tests that touch process-global state** (e.g. `TOKEN_CACHE`) must use a serialization mutex or equivalent mechanism to be safe under any `--test-threads` value.

---

## Decisions Log

| Decision | Choice | Alternative Considered | Rationale |
|----------|--------|----------------------|-----------|
| App framework | Tauri v2 | Electron | Smallest binary, strongest security sandbox, OS-native WebView patching, Rust memory safety |
| Frontend | SvelteKit | React, Vue | Lightweight, fast compilation, minimal runtime overhead — ideal for Tauri |
| Code editor | CodeMirror 6 | Monaco | Lighter weight, excellent Markdown/YAML extensions, MIT licensed, easier to embed |
| Git backend | git2 (Rust) | simple-git, isomorphic-git | No subprocess spawning = no shell injection; native Tauri integration; best security posture |
| GitHub API | octocrab (Rust) | @octokit/rest (JS) | Keeps API calls in Rust backend (security boundary); typed responses |
| Auth | GitHub App Device Flow | OAuth App, PATs, SSH | No embedded secrets, fine-grained per-repo permissions, short-lived tokens, GitHub-recommended |
| Token storage | tauri-plugin-stronghold | keytar, plaintext | Encrypted vault (XChaCha20-Poly1305), purpose-built for Tauri |
| Preview | Hybrid (client-side + Jekyll) | Jekyll only, client-side only | Fast feedback during editing + exact fidelity on demand |
| Target OS | All three (Linux, macOS, Windows) | Linux first | Tauri natively supports all three; WebView differences are manageable |
| Publish workflow | One-click Publish (stage+commit+push) | Stage/unstage/commit/push separately | Target users want simple editing; advanced git users can use GitHub directly |

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| User doesn't have Ruby/Jekyll installed | Cannot use full preview | Detect on first use, show install instructions with links; client-side preview still works; consider future Docker option |
| WebView rendering differences across OS | Preview may look different on Linux vs macOS vs Windows | Use CSS normalization; test on all three; document known differences |
| GitHub App rate limits | API calls fail | Cache repo lists; 5,000 req/hr is ample for single-user editor |
| Large repositories | Slow clone, high disk usage | Implement shallow clone; lazy-load file tree; show clone progress |
| Merge conflicts on push | User loses work or is confused | Always fetch before push; show clear conflict dialog; support rebase and merge strategies |
| Stronghold vault corruption | Tokens lost, user must re-authenticate | Graceful fallback: detect corruption, clear vault, prompt re-auth; tokens are easily re-obtained |
| Jekyll subprocess hangs | Port stays occupied, app hangs | Implement timeout (60s for build); kill on app close via `Drop` trait; random port selection |
