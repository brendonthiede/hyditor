# Jekyll Prerequisites

Hyditor's **Full Preview** mode runs Jekyll locally to render your site. If Jekyll is not installed, the preview panel will show an error with a link back to this page.

## Linux

Most distributions ship Ruby via the system package manager, but a version manager like **rbenv** gives more control:

```bash
# Option A: system Ruby (Debian/Ubuntu)
sudo apt install -y ruby-full build-essential zlib1g-dev
gem install bundler jekyll

# Option B: rbenv (recommended for managing multiple Ruby versions)
# Follow https://github.com/rbenv/rbenv#installation then:
rbenv install 3.2.8        # or whichever version your site requires
rbenv global 3.2.8
gem install bundler jekyll
```

If your repository includes a `.ruby-version` file, make sure the listed version is installed (`rbenv install $(cat .ruby-version)`).

## macOS

Ruby is pre-installed but often outdated. Use **rbenv** via Homebrew:

```bash
brew install rbenv ruby-build
rbenv init   # follow the printed instructions to update your shell profile
rbenv install 3.2.8
rbenv global 3.2.8
gem install bundler jekyll
```

## Windows

Install Ruby via [RubyInstaller](https://rubyinstaller.org/) (the **Ruby+Devkit** variant):

1. Download and run the installer; select **"Add Ruby executables to your PATH"**.
2. At the end of the installer, run the `ridk install` step (choose option 3 — MSYS2 + MINGW development toolchain).
3. Open a new terminal and run:

```powershell
gem install bundler jekyll
```

> **Important — system PATH requirement:**  Hyditor is a GUI application (`windows_subsystem = "windows"`) and does not inherit shell profile customizations. Ruby, Bundler, and Jekyll must be on the **system PATH** (the one in **System Properties → Environment Variables → System variables → Path**), not just a user-profile or PowerShell-profile PATH. RubyInstaller adds itself to the system PATH by default when "Add Ruby executables to your PATH" is checked during installation.
>
> To verify, open a **new** Command Prompt (`cmd.exe`) — not PowerShell — and run `where ruby`, `where bundle`, and `where jekyll`. If any of those fail, the commands are not on the system PATH and Hyditor will not find them.

## Verifying the installation

After installing, confirm that all three commands are available in a **new** terminal:

**Linux / macOS (bash):**

```bash
ruby --version    # e.g. ruby 3.2.8
bundle --version  # e.g. Bundler version 2.x
jekyll --version  # e.g. jekyll 4.x
```

**Windows (Command Prompt — not PowerShell):**

```cmd
where ruby
where bundle
where jekyll
```

Using Command Prompt (`cmd.exe`) for verification is important because Hyditor launches Jekyll via `cmd.exe`, not PowerShell. If the commands are only available in PowerShell (e.g. via a profile script), Hyditor will not find them.

If you use a version manager (rbenv, rvm, asdf) on Linux/macOS, ensure the correct Ruby version is active in the directory where Hyditor clones repositories (`~/.cache/hyditor/repos/` by default on Linux).

## Per-repository setup

Most Jekyll sites include a `Gemfile`. When Full Preview starts, Hyditor runs `bundle install` automatically before launching Jekyll. If `bundle install` fails, check:

- The `Gemfile` is valid and committed.
- Your Ruby version satisfies any version constraint in the `Gemfile` or `.ruby-version`.
- Native extension build dependencies are installed (e.g. `build-essential` on Debian/Ubuntu).
