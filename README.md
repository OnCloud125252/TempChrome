# TempChrome

**Launch Chromium with throwaway profiles — isolated browsing sessions that leave no trace.**

## Table of Contents

- [TempChrome](#tempchrome)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Usage](#usage)
    - [Launch a Temporary Session](#launch-a-temporary-session)
    - [Auto-Cleanup](#auto-cleanup)
    - [Chromium Arguments](#chromium-arguments)
  - [Install and Update Chromium](#install-and-update-chromium)
    - [Architecture Support](#architecture-support)
  - [How It Works](#how-it-works)
  - [FAQs](#faqs)
    - [Why not just use Chrome's incognito mode?](#why-not-just-use-chromes-incognito-mode)
    - [Where do the profiles go?](#where-do-the-profiles-go)
    - [Does this work on Linux?](#does-this-work-on-linux)
    - [Why download from snapshots instead of Homebrew?](#why-download-from-snapshots-instead-of-homebrew)
    - [Can I use this with regular Chrome instead of Chromium?](#can-i-use-this-with-regular-chrome-instead-of-chromium)
  - [Installation](#installation)
  - [Development](#development)
    - [Git Hooks](#git-hooks)
    - [Optional Tooling](#optional-tooling)

## Overview

TempChrome creates an isolated Chromium profile in `/tmp`, launches the browser, and optionally cleans up after you close it. Each session gets its own 10-character random ID — no cookies, history, or extensions carry over between sessions.

```bash
tempchrome
```

That's it. You get a fresh Chromium window with a brand-new profile. When you're done, close the browser.

## Usage

### Launch a Temporary Session

```bash
tempchrome
```

The profile lives at `/tmp/tempchrome_profile/<random-id>` until you delete it or use `--auto-cleanup`.

### Auto-Cleanup

```bash
tempchrome --auto-cleanup
```

The profile directory is automatically deleted when Chromium closes. Useful for truly ephemeral sessions — nothing stays on disk.

### Chromium Arguments

You can pass any Chromium flags directly:

```bash
tempchrome --incognito
tempchrome --disable-extensions
tempchrome --auto-cleanup --incognito
```

Everything after TempChrome's own flags gets forwarded to Chromium.

## Install and Update Chromium

TempChrome can download the latest Chromium directly from Google's official snapshot storage — no Homebrew needed.

```bash
tempchrome --install
```

This fetches the latest snapshot, extracts it, clears macOS quarantine attributes, and installs to `/Applications/Chromium.app`. If an existing installation is found, it's moved to trash first.

Run the same command to update:

```bash
tempchrome --update
```

`--install` and `--update` are interchangeable.

### Architecture Support

Architecture is auto-detected:

| Chip | Platform ID | Detected via |
|------|-------------|--------------|
| Apple Silicon (M1/M2/M3/M4) | `Mac_Arm` | `uname -m` → `arm64` |
| Intel | `Mac` | `uname -m` → anything else |

## How It Works

1. **Profile creation** — generates a random 10-character ID, creates a directory at `/tmp/tempchrome_profile/<id>` with `700` permissions (atomic `mkdir` with collision avoidance)
2. **Quarantine clearing** — runs `xattr -cr` on `Chromium.app` to prevent macOS Gatekeeper warnings
3. **Google API keys** — injects Chromium API credentials as environment variables so Google sign-in works out of the box
4. **Launch** — starts Chromium with `--user-data-dir` pointed at the temp profile, plus `--disable-fre`, `--no-first-run`, and `--no-default-browser-check`
5. **Cleanup** (optional) — if `--auto-cleanup` is set, a `trap EXIT` removes the profile directory when Chromium closes

## FAQs

#### Why not just use Chrome's incognito mode?

Incognito mode still shares extensions, settings, and the same browser process. TempChrome gives you a completely separate profile — different extensions, different cookies, different everything.

#### Where do the profiles go?

`/tmp/tempchrome_profile/<random-id>`. Without `--auto-cleanup`, profiles persist until you delete them or the OS clears `/tmp`.

#### Does this work on Linux?

No. TempChrome is **macOS-only** — it depends on `/Applications/`, `xattr`, and macOS-specific Chromium snapshot paths.

#### Why download from snapshots instead of Homebrew?

The Homebrew `chromium` cask is deprecated as of September 2026. Google's official snapshot storage provides the latest builds directly.

#### Can I use this with regular Chrome instead of Chromium?

No. The script targets Chromium specifically (`/Applications/Chromium.app`). Chrome uses a different binary path and doesn't support the same snapshot download mechanism.

## Installation

**Requirements:** macOS (Intel or Apple Silicon), `bash`, `curl`, `unzip`, `jq` is not required.

1. Clone the repository:

```bash
git clone https://github.com/<your-username>/TempChrome.git
cd TempChrome
chmod +x cli/tempchrome.sh
```

1. Make it available as a command (pick one):

```bash
# Option A: symlink to a directory in your PATH
ln -s "$(pwd)/cli/tempchrome.sh" /usr/local/bin/tempchrome

# Option B: copy directly
cp cli/tempchrome.sh /usr/local/bin/tempchrome
```

1. Install Chromium:

```bash
tempchrome --install
```

## Development

### Git Hooks

TempChrome ships a set of git hooks under `.githooks/` that enforce secret scanning, shell-script linting, and Raycast-extension build integrity. They activate automatically the first time you run `bun install` inside `raycast/`:

```bash
(cd raycast && bun install)
```

That runs `raycast/scripts/prepare.mjs`, which sets `core.hooksPath` to `.githooks` in your local git config. Confirm with:

```bash
git config --get core.hooksPath   # → .githooks
```

| Hook         | What it runs                                                                            |
|--------------|-----------------------------------------------------------------------------------------|
| `pre-commit` | `gitleaks` (staged) · `shellcheck` (staged `.sh`) · `ray lint --fix` (re-stages fixes)  |
| `pre-push`   | `gitleaks` (push range) · `shellcheck` (all tracked `.sh`) · `ray lint` · `ray build`   |
| `post-merge` | `bun install` inside `raycast/` when `raycast/bun.lock` or `raycast/package.json` moved |

`ray build` also performs a full TypeScript compile, so it doubles as the typecheck gate.

In rare emergencies you can bypass the commit or push hook with `--no-verify`. Prefer fixing the underlying issue — the checks exist to stop broken or secret-leaking commits from reaching the remote.

### Optional Tooling

These tools are referenced by the hooks. They're optional — the hooks warn and skip when missing — but installing them restores the full pipeline.

```bash
brew install gitleaks    # secret scanner used by pre-commit & pre-push
brew install shellcheck  # shell linter used by pre-commit & pre-push
```

Bun is required to work on the Raycast extension. Install via [bun.sh](https://bun.sh) or `brew install oven-sh/bun/bun`.
