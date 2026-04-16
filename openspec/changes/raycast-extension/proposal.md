## Why

TempChrome currently only ships as a CLI (`cli/tempchrome.sh`). macOS users who prefer GUI launchers must open a terminal every time they want a temporary Chromium session. A Raycast extension brings TempChrome's launch, profile management, and install workflows into a native macOS launcher with zero terminal friction for day-to-day use, while keeping the CLI as the single source of truth for snapshot installation.

## What Changes

- Add a Raycast extension under `raycast/` with **two top-level commands**:
  - **Launch TempChrome** — `no-view` command that creates a temp profile and launches Chromium instantly. Intended to be bound to a hotkey or alias via Raycast settings for muscle-memory use.
  - **TempChrome** — `view` command rendering a List that routes to three items:
    - *Launch Now* — identical behavior to the no-view command (convenience duplicate)
    - *Launch with Options…* — push-navigates to a Form sub-view with flag toggles and a custom-arguments text field
    - *Manage Temp Profiles…* — push-navigates to a List sub-view for profile inspection and deletion
    - *Install or Update Chromium…* — opens Terminal.app via `osascript` and runs `tempchrome --install`
- **Install delegates to the CLI**: no native TypeScript download/extract pipeline. The Raycast action opens Terminal.app and runs `tempchrome --install` there, preserving the CLI's existing progress UX (curl progress bar, shell-native extraction).
- **Auto-cleanup via opportunistic sweep**: when a launch command (either command) spawns Chromium, a fire-and-forget async sweep runs after spawn. It reads the auto-cleanup registry from `LocalStorage`, detects which registered profiles are no longer in use (via `ps` matching on `--user-data-dir`), and trashes them. Eventually-consistent, no background processes.
- Chromium binary path and temp profile directory are configurable via extension-level Raycast Preferences, defaulting to the same values the CLI uses.
- Profile list shows disk size, creation time, in-use indicator, and auto-cleanup badge.
- Destructive actions (delete profile, delete all) use `confirmAlert`. In-use deletes require an additional "Delete Anyway" confirmation.
- All subprocess calls use `execFile` with argument arrays (no shell invocation, no injection risk).

## Capabilities

### New Capabilities
- `quick-launch`: No-view command that creates a temp profile, spawns Chromium with base flags and Google API env vars, and triggers the opportunistic auto-cleanup sweep. Also reachable as the "Launch Now" item inside the `TempChrome` List command.
- `launch-options`: Form sub-view under the `TempChrome` List command. Exposes browsing mode (Normal/Incognito), Disable Web Security, Disable Extensions, Auto-Cleanup, and a custom-arguments text field. Submission launches Chromium and triggers the same sweep.
- `chromium-installer`: Thin action under the `TempChrome` List command that opens Terminal.app via `osascript` and runs `tempchrome --install`. No TypeScript-native download/extract logic.
- `profile-manager`: List sub-view under the `TempChrome` List command. Shows every subdirectory of the configured temp base directory with size, creation time, in-use status, and auto-cleanup badge. Actions: Show in Finder, Copy Path, Launch with This Profile, Delete Profile, Delete All Idle Profiles, Clean Up Stale Profiles.

### Modified Capabilities
<!-- No existing Raycast capabilities — this is the first Raycast extension in the project -->

## Impact

- **New directory**: `raycast/` — Raycast extension project (`package.json`, `tsconfig.json`, `.eslintrc.json`, `src/`, `assets/`)
- **Runtime dependencies**: `@raycast/api`, `@raycast/utils`
- **Dev dependencies**: `typescript`, `@raycast/eslint-config`, `eslint`, `prettier`, `@types/node`, `@types/react`
- **File system**: reads and writes `<tempBaseDir>` (default `/tmp/tempchrome_profile/`); reads `<chromiumPath>` (default `/Applications/Chromium.app/Contents/MacOS/Chromium`)
- **External processes**: spawns Chromium directly via `child_process.spawn` (detached + unref'd); invokes `execFile` for `ps`, `trash`, `xattr`, and `osascript`
- **CLI dependency**: the Install action requires `tempchrome` to be on the user's shell PATH (invoked inside the Terminal session). Everything else in the extension is independent of the CLI.
- **No changes to `cli/tempchrome.sh`** — the Raycast extension is a parallel interface, and the Install action delegates to the unmodified CLI.
