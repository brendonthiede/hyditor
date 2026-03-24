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

Hyditor launches Jekyll via `powershell.exe` on Windows, so Ruby, Bundler, and Jekyll must be on the **system or user PATH** (visible in **System Properties → Environment Variables**). RubyInstaller adds itself to PATH by default when "Add Ruby executables to your PATH" is checked during installation.

## Verifying the installation

After installing, confirm that all three commands are available in a **new** terminal:

```bash
ruby --version    # e.g. ruby 3.2.8
bundle --version  # e.g. Bundler version 2.x
jekyll --version  # e.g. jekyll 4.x
```

On Windows, run those commands in **PowerShell** — that is what Hyditor uses to launch Jekyll.

If you use a version manager (rbenv, rvm, asdf) on Linux/macOS, ensure the correct Ruby version is active in the directory where Hyditor clones repositories (`~/.cache/hyditor/repos/` by default on Linux).

## Per-repository setup

Most Jekyll sites include a `Gemfile`. When Full Preview starts, Hyditor runs `bundle install` automatically before launching Jekyll. If `bundle install` fails, check:

- The `Gemfile` is valid and committed.
- Your Ruby version satisfies any version constraint in the `Gemfile` or `.ruby-version`.
- Native extension build dependencies are installed (e.g. `build-essential` on Debian/Ubuntu).

### `wdm` gem build failure on Windows

The `wdm` (Windows Directory Monitor) gem version 0.1.x fails to compile with Ruby 3.2 and later. Hyditor automatically works around this by retrying `bundle install` with the `wdm` gem skipped — Jekyll will fall back to polling for file changes, which works fine for previewing.

If you still see `wdm`-related errors, you can fix it permanently by updating your site's `Gemfile`:

```ruby
# Replace this:
gem "wdm", "~> 0.1.1"

# With this:
gem "wdm", "~> 0.2.0"
```

Then run `bundle update wdm` from your site directory.

## Troubleshooting logs

Hyditor writes Full Preview diagnostics to a persistent `preview.log` file. This includes startup messages, `bundle install` output, and Jekyll stdout/stderr.

- Windows: `%LOCALAPPDATA%\\hyditor\\logs\\preview.log`
- Linux: `~/.local/share/hyditor/logs/preview.log`
- macOS: `~/Library/Application Support/hyditor/logs/preview.log`

If Full Preview fails with an early exit message, open this file first to see the underlying Ruby/Bundler/Jekyll error details.
