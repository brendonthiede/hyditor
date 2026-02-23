# Hyditor — Implementation Plan

> A secure, desktop-native editor and previewer for Jekyll sites on GitHub Pages.

## TL;DR

Hyditor is a **Tauri v2** desktop application (Rust backend + SvelteKit frontend) that lets users clone, edit, preview, and push Jekyll sites hosted on GitHub Pages. It provides a **CodeMirror 6** editor with YAML front matter support, a **hybrid preview** system (instant client-side Markdown rendering + full local Jekyll builds), and **responsive viewport simulation** for desktop/tablet/mobile. Authentication uses the **GitHub App Device Flow** for maximum security — no secrets embedded in the binary, fine-grained per-repo permissions, and short-lived tokens stored in the OS keychain via `tauri-plugin-stronghold`. Changes are committed via **git2** (Rust libgit2 binding, no subprocess spawning) and can be pushed directly to `main` or through a Pull Request created via the GitHub API.

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
│  │  │CodeMirror│ │ Preview   │ │  Git/PR  │  │   │
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
| **GitHub API** | `octocrab` crate (Rust) | Create PRs, list repos, check statuses, manage branches |
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
   - Token has fine-grained permissions: `contents:write`, `pull_requests:write`, `metadata:read`
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
  - Permissions: Repository contents (read/write), Pull requests (read/write), Metadata (read)
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

### Phase 2: Pull Request Workflow & Full Preview

> Goal: Create PRs, branch management, and full Jekyll preview.

**Step 7: Branch management**
- Implement Rust command `git::create_branch(repo_path, branch_name)`:
  - Create new branch from current HEAD
  - Checkout the new branch
  - Branch name auto-suggested from post title or change description
- Implement Rust command `git::list_branches(repo_path)`:
  - List local and remote branches
- Implement Rust command `git::switch_branch(repo_path, branch_name)`:
  - Checkout existing branch, stash uncommitted changes if needed
- Frontend: Branch selector dropdown in the toolbar
  - "New Branch" button for PR workflow
  - Visual indicator of current branch

**Step 8: Pull Request creation**
- Implement Rust command `github::create_pr(token, owner, repo, head, base, title, body)`:
  - Use `octocrab` to create PR via GitHub API
  - Auto-fill title from commit message or branch name
  - Auto-fill body with summary of changes (files modified, posts added/edited)
- Implement Rust command `github::list_prs(token, owner, repo)`:
  - List open PRs for the repo
  - Show status checks, review status
- Frontend: PR creation dialog
  - Pre-filled title and description
  - Base branch selector (defaults to repo's default branch)
  - "Create PR" button → opens PR in browser after creation
  - Option to push directly to main with confirmation ("Are you sure? This will publish immediately.")

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
│   │   │   ├── clone.rs          # Repo cloning via git2
│   │   │   ├── commit.rs         # Staging & committing
│   │   │   ├── branch.rs         # Branch management
│   │   │   ├── push.rs           # Push with HTTPS token auth
│   │   │   └── status.rs         # Working directory status & diffs
│   │   ├── github/
│   │   │   ├── mod.rs
│   │   │   ├── repos.rs          # List repos, check Pages status
│   │   │   └── pull_request.rs   # Create & list PRs
│   │   ├── preview/
│   │   │   ├── mod.rs
│   │   │   └── jekyll.rs         # Jekyll subprocess management
│   │   └── fs/
│   │       ├── mod.rs
│   │       └── scoped.rs         # Scoped filesystem access
│   └── icons/                    # App icons
├── src/                          # SvelteKit frontend
│   ├── app.html
│   ├── app.css                   # Global styles, theme variables
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Editor.svelte         # CodeMirror 6 wrapper
│   │   │   ├── Preview.svelte        # Markdown preview + iframe
│   │   │   ├── FileTree.svelte       # Sidebar file browser
│   │   │   ├── GitPanel.svelte       # Status, staging, commit, push
│   │   │   ├── BranchSelector.svelte # Branch picker
│   │   │   ├── PRDialog.svelte       # Pull request creation
│   │   │   ├── FrontMatterForm.svelte# Structured front matter editor
│   │   │   ├── ViewportToolbar.svelte# Desktop/tablet/mobile presets
│   │   │   ├── AuthScreen.svelte     # Device flow sign-in
│   │   │   └── RepoSelector.svelte   # Repo picker
│   │   ├── stores/
│   │   │   ├── auth.ts           # Auth state
│   │   │   ├── repo.ts           # Active repo state
│   │   │   ├── editor.ts         # Editor state (open files, dirty flags)
│   │   │   └── preview.ts        # Preview mode & viewport state
│   │   ├── tauri/
│   │   │   ├── auth.ts           # IPC wrappers for auth commands
│   │   │   ├── git.ts            # IPC wrappers for git commands
│   │   │   ├── github.ts         # IPC wrappers for GitHub API commands
│   │   │   ├── fs.ts             # IPC wrappers for file operations
│   │   │   └── preview.ts        # IPC wrappers for Jekyll preview
│   │   └── utils/
│   │       ├── markdown.ts       # remark/rehype rendering pipeline
│   │       ├── frontmatter.ts    # gray-matter parsing helpers
│   │       └── jekyll.ts         # Jekyll filename conventions, slug generation
│   └── routes/
│       ├── +layout.svelte        # App shell layout
│       └── +page.svelte          # Main editor page
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
| **Permissions** | Repository: Contents (R/W), Pull Requests (R/W), Metadata (R) |
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
- [ ] Commit changes directly to main, push, verify on GitHub
- [ ] Create a new branch, commit, create PR, verify PR appears on GitHub
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

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| User doesn't have Ruby/Jekyll installed | Cannot use full preview | Detect on first use, show install instructions with links; client-side preview still works; consider future Docker option |
| WebView rendering differences across OS | Preview may look different on Linux vs macOS vs Windows | Use CSS normalization; test on all three; document known differences |
| GitHub App rate limits | API calls fail | Cache repo lists and PR statuses; 5,000 req/hr is ample for single-user editor |
| Large repositories | Slow clone, high disk usage | Implement shallow clone; lazy-load file tree; show clone progress |
| Merge conflicts on push | User loses work or is confused | Always fetch before push; show clear conflict dialog; support rebase and merge strategies |
| Stronghold vault corruption | Tokens lost, user must re-authenticate | Graceful fallback: detect corruption, clear vault, prompt re-auth; tokens are easily re-obtained |
| Jekyll subprocess hangs | Port stays occupied, app hangs | Implement timeout (60s for build); kill on app close via `Drop` trait; random port selection |
