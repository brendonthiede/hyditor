# Copilot Instructions for Hyditor

## Project Overview

Hyditor is a **Tauri v2** desktop application (Rust backend + SvelteKit/TypeScript frontend) for editing and previewing Jekyll sites on GitHub Pages. It uses CodeMirror 6 for editing, a hybrid preview system (instant Markdown + full Jekyll), and GitHub App Device Flow authentication with Stronghold-encrypted token storage.

**License:** GPLv3  
**Target platforms:** Linux, macOS, Windows

## Tech Stack

| Layer | Technology |
|---|---|
| App framework | Tauri v2 (Rust) |
| Frontend | SvelteKit + TypeScript |
| Editor | CodeMirror 6 |
| Git | `git2` crate (Rust libgit2, no subprocess) |
| Auth | GitHub App Device Flow → `tauri-plugin-stronghold` |
| Preview | Client-side remark/rehype + Jekyll subprocess |
| AI | Google Gemini API (backend `reqwest` + frontend chat UI) |

## Project Structure

- `src-tauri/src/` — Rust backend: `ai/`, `auth/`, `fs/`, `git/`, `github/`, `preview/`
- `src/lib/components/` — Svelte UI components
- `src/lib/stores/` — Svelte stores (ai, auth, editor, layout, preview, repo)
- `src/lib/tauri/` — TypeScript IPC wrappers for Tauri commands
- `src/lib/utils/` — Pure utility functions (markdown, frontmatter, jekyll, errors)
- `src/routes/` — SvelteKit pages

## Validation Commands

Run the full validation suite before considering any change done:

```bash
# Frontend (must all pass with zero errors/warnings/failures)
npm run check
npm run lint
npm test

# Backend (must all pass with zero failures — run from src-tauri/)
cd src-tauri && cargo test
```

## Test Policy (mandatory)

- **All tests must pass.** The full validation suite must complete with zero errors and zero failures before any change is considered done.
- **Never skip, ignore, or disable tests** to make the suite pass. Do not add `#[ignore]`, `skip()`, or conditional gates that bypass tests related to existing code.
- **Never dismiss failures as "pre-existing" or "flaky."** If a test fails intermittently, fix the root cause (add synchronization, isolate shared state, remove race conditions) rather than ignoring the failure.
- **Do not use `--test-threads=1`** or any other workaround to mask concurrency bugs; fix the root cause instead.
- **Tests that touch process-global state** (e.g. `TOKEN_CACHE`) must use a serialization mutex or equivalent mechanism to be safe under any `--test-threads` value.

## Contributor Workflow

- README updates are required as part of "done" for every completed feature, architecture change, or workflow change.
- Update both README sections when relevant:
  - `Implemented (Phase 1)` with completed deliverables.
  - `Next Work` by removing completed items and adding/refining upcoming work.
- If commands, prerequisites, or test workflows change, update `Quick Start` and `Tests` in the same PR.

## PR Checklist

Every PR must satisfy:

- [ ] Feature/status docs updated in README (`Implemented` + `Next Work`).
- [ ] Any command, setup, or test workflow changes reflected in README (`Quick Start` / `Tests`).
- [ ] Frontend validation (`npm run check`, `npm run lint`, `npm test`) — zero errors, zero failures.
- [ ] Backend validation (`cd src-tauri && cargo test`) — zero failures.
- [ ] `npm audit --omit=dev` reviewed for production-impacting vulnerabilities.
- [ ] No tests were skipped, disabled, or marked `#[ignore]` to make the suite pass.

## Key Conventions

- Tauri IPC commands are registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`
- Frontend IPC wrappers live in `src/lib/tauri/` and call `tauriInvoke()`
- Store functions in `src/lib/stores/repo.ts` handle auth-expired errors via `handleAuthExpiredError()`
- Scoped filesystem commands reject paths outside the cloned repo root
- The publish workflow is intentionally simple: no staging/unstaging UI, no PR creation, no branch creation from UI
