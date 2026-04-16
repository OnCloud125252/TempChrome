## Context

TempChrome is a macOS shell script (`cli/tempchrome.sh`, ~256 lines) that launches Chromium with temporary, isolated user profiles. It handles architecture detection, Chromium installation from Google's snapshot storage, collision-resistant temp profile creation, and synchronous auto-cleanup via `trap cleanup EXIT`. The project wants a Raycast extension as a parallel GUI interface. The CLI remains the source of truth for snapshot installation — the Raycast install action delegates to it rather than reimplementing its logic.

The `raycast/` directory currently exists but is empty. A comprehensive Raycast extension skill (`.claude/skills/raycast-extension/SKILL.md`) documents project conventions for Raycast development (performance patterns, caching, TypeScript best practices).

Key constraints from the environment:
- **macOS-only**. Raycast is macOS-only; matches TempChrome's existing scope.
- **Intel + Apple Silicon**. Both architectures must work (same as CLI).
- **Google API keys**. The CLI embeds three env vars (`GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID`, `GOOGLE_DEFAULT_CLIENT_SECRET`) that unlock Gemini/sync/sign-in. The Raycast extension spawns Chromium with the same env vars. These are Debian-origin public keys; see `CLAUDE.md`.
- **Raycast command lifecycle**. Raycast commands are short-lived processes — they exit after the HUD is shown. They cannot `wait()` on Chromium the way the CLI does. Any CLI feature that relies on blocking until Chromium exits (specifically `--auto-cleanup`) must be redesigned for eventual consistency.
- **Extension-level preferences**. Chromium path and temp dir must be user-configurable without per-command clutter.

## Goals / Non-Goals

**Goals:**
- Native Raycast UI for launching Chromium with temporary profiles — both quick (one keystroke) and configurable (form-based).
- Zero-friction quick-launch via a dedicated `no-view` command that can be bound to a hotkey or alias in Raycast settings.
- Unified `TempChrome` List command as the entry point for secondary actions (Launch Now, Launch with Options, Manage Profiles, Install).
- Auto-cleanup semantics close enough to the CLI's `--auto-cleanup` (eventually cleaned up, not leaking forever) without any background process.
- Delegate install to the CLI via Terminal.app — one source of truth for snapshot download/extract logic.
- Follow Raycast best practices: async I/O only, `execFile` over `exec`, `spawn` for long-running children with `detached: true` + `unref()`.

**Non-Goals:**
- Replacing the CLI. Both interfaces coexist; the Raycast install action *depends on* the CLI.
- Background processes, LaunchAgents, cron jobs, or other out-of-band cleanup mechanisms.
- Cross-platform support (Linux, Windows).
- Chromium version pinning, rollback, or offline install.
- Profile data migration, sync, or import/export.
- Reimplementing snapshot download/extract/xattr in TypeScript.

## Decisions

### 1. Two top-level commands: no-view quick-launch + List router

**Decision**: Ship exactly two Raycast commands:
- `launch` (mode `no-view`): creates a temp profile and launches Chromium instantly, shows a HUD, exits.
- `tempchrome` (mode `view`): renders a root `List` with four items:
  - *Launch Now* — identical behavior to the no-view command.
  - *Launch with Options…* — `Action.Push` to a Form sub-view (see capability `launch-options`).
  - *Manage Temp Profiles…* — `Action.Push` to a List sub-view (see capability `profile-manager`).
  - *Install or Update Chromium…* — `Action` that opens Terminal via `osascript` and exits.

**Rationale**: The no-view command is kept as a dedicated top-level entry so users can assign a hotkey or alias to it in Raycast settings. That gives muscle-memory quick-launch without round-tripping through a List. Every secondary action lives inside the `tempchrome` command, which keeps Raycast's root search from accumulating four TempChrome entries. The *Launch Now* duplicate inside the List is cheap and prevents users who opened the List for something else from having to back out to quick-launch.

**Alternative considered**: Four separate top-level commands (proposed earlier, now rejected). That approach polluted Raycast root search with three secondary actions without UX gain.

### 2. Install delegates to the CLI via `osascript` + Terminal.app

**Decision**: The *Install or Update Chromium…* action invokes:

```
execFile("osascript", [
  "-e", 'tell application "Terminal" to activate',
  "-e", 'tell application "Terminal" to do script "tempchrome --install"',
])
```

It then calls `showHUD("Opening Terminal to install Chromium…")` and the Raycast command exits. The Raycast extension performs no network I/O, no archive extraction, no file-permission manipulation.

**Rationale**: Snapshot download is a fundamentally CLI-shaped task. `curl` already shows a progress bar in Terminal; `unzip` is shell-native; `xattr` is shell-native; the CLI's install flow is mature and shellcheck-clean. Reimplementing in TypeScript would duplicate ~150 lines of streaming/extraction/quarantine logic for a worse progress UX (Raycast's Detail view has no native progress bar, so the best we could offer is a markdown table that re-renders — strictly inferior to curl's real progress bar). Delegating keeps install logic in one place.

**Alternative considered**: Native TypeScript streaming fetch + unzip + xattr (the earlier design). Rejected: duplicates logic, increases bug surface, marginal UX gain.

**Consequence**: The Install action hard-depends on `tempchrome` being on the user's shell PATH. If missing, Terminal shows `command not found` — a natural and informative failure mode. No pre-validation from the extension side.

### 3. Auto-cleanup: opportunistic post-launch sweep, fire-and-forget

**Decision**: Both launch paths (`launch` command and the Form submission in `tempchrome`) follow this sequence:

1. Create the new temp profile directory.
2. Spawn Chromium with `child.unref()`.
3. (Synchronous up to here; HUD is ready to show.)
4. Asynchronously — *not* awaited — invoke `sweepStaleProfiles()`:
   - Read the auto-cleanup registry from `LocalStorage` under key `tempchrome.auto-cleanup-registry` (shape: `Record<string, number>` mapping profile path → creation timestamp).
   - Run `execFile("ps", ["-Ao", "args="])` once.
   - For each registered profile path P, determine `inUse` by checking whether any `ps` line contains the substring `--user-data-dir=<P>`.
   - For every P not in use: `execFile("trash", [P])` (or `fs.rm` fallback if `trash` is missing), then `delete registry[P]`.
   - Write the updated registry back.
   - Swallow all errors — a failed sweep must never surface to the user.
5. Show the HUD and exit.

**Rationale**: This mirrors the CLI's `--auto-cleanup` semantics with eventual consistency. Stale profiles get trashed the next time the user launches — almost always within minutes to hours. No background process, no LaunchAgent, no orphan child. Running the sweep after Chromium spawn (not before) keeps the launch latency indistinguishable from a "dumb" launch — the user's browser opens immediately while disk I/O happens in the background.

**Alternative considered**:
- *Synchronous pre-launch sweep* — adds latency proportional to registry size. Rejected for quick-launch where instant-feel matters.
- *Detached Node process that `waitpid`s on Chromium PID* — true async cleanup but introduces an orphan process, which the Non-Goals explicitly rule out.
- *LaunchAgent / cron* — explicitly out of scope.
- *Immediate cleanup on Chromium exit via N-API or similar* — prohibitively complex for the gain.

**Trade-off note**: The UI label is "Auto-Cleanup" because it is auto — just eventually-consistent, not immediate. The `profile-manager` capability provides "Clean Up Stale Profiles" as a manual trigger for users who want immediate cleanup.

### 4. In-use detection via `ps -Ao args=`

**Decision**: One function — `getChromiumProcessArgs()` — runs `execFile("ps", ["-Ao", "args="])` and returns the stdout split by newlines. `isProfileInUse(path, psLines)` returns `true` iff any line contains the exact substring `--user-data-dir=<path>`.

**Rationale**: `ps -Ao args=` is stable across macOS versions and prints every process's argv without a header line. No external dependencies. The Chromium flag format is fixed — matching on substring is safe because the flag form `--user-data-dir=<absolute-path>` is unambiguous.

**Alternative considered**: File locks, PID files, or `lsof` — over-engineered; Chromium doesn't write standard lock files we could reliably poll.

**Optimization**: Refresh runs `ps` once and reuses the result across all profiles in the list, rather than calling `ps` per profile.

### 5. Preferences: two extension-level entries

**Decision**: Two extension-level preferences in `package.json` under `preferences`:
- `chromiumPath` (type `textfield`, default `/Applications/Chromium.app/Contents/MacOS/Chromium`)
- `tempBaseDir` (type `textfield`, default `/tmp/tempchrome_profile`)

**Rationale**: Extension-level keeps the Form UI uncluttered. Command-level preferences would require re-entry per command or per-command duplication.

### 6. File deletion via `trash` CLI with `fs.rm` fallback

**Decision**: All profile deletion flows through a single `trashPath(path)` helper:
1. Try `execFile("trash", [path])`.
2. On `ENOENT` from execFile (binary missing), fall back to `fs.promises.rm(path, { recursive: true, force: true })` and show a one-time toast ("`trash` CLI not found — deleting permanently") gated by a module-level boolean.

**Rationale**: `CLAUDE.md` mandates `trash` over `rm` (files go to macOS Trash, recoverable). The fallback prevents hard failure on minimal systems. The one-time toast educates users without spamming them.

### 7. Child process conventions: `execFile` for short-lived, `spawn` for Chromium

**Decision**:
- **Short-lived commands** (`ps`, `trash`, `xattr`, `osascript`): `execFile` promisified via `util.promisify`, with explicit argument arrays. No shell.
- **Chromium launch**: `child_process.spawn(chromiumPath, args, { detached: true, stdio: "ignore", env })` followed immediately by `child.unref()`.

**Rationale**: `execFile` avoids shell-injection risk and saves ~16ms per call (no shell fork). `spawn` with `detached: true` + `unref()` lets Chromium outlive the Raycast extension process. `stdio: "ignore"` closes all three streams so Chromium doesn't write to the dead parent's descriptors.

### 8. Chromium launch: quarantine clear + env vars

**Decision**: Before `spawn`:
1. Derive the `.app` bundle path from the binary path (walk up from `Contents/MacOS/Chromium` to the enclosing `.app`).
2. `execFile("xattr", ["-cr", appBundlePath])` — clears Gatekeeper quarantine attributes recursively. Swallow errors (non-critical; Chromium still launches).

`env` passed to `spawn` is `{ ...process.env, GOOGLE_API_KEY: "...", GOOGLE_DEFAULT_CLIENT_ID: "...", GOOGLE_DEFAULT_CLIENT_SECRET: "..." }` — identical to the CLI's env.

**Rationale**: Matches CLI behavior byte-for-byte (same env, same base flags, same quarantine clear). Chromium will not pop the Gatekeeper dialog on first launch after Install.

## Risks / Trade-offs

**[Risk] Install action requires `tempchrome` on PATH**
→ Mitigation: Terminal surfaces `command not found` naturally when missing. The project's `README.md` documents the PATH setup. The Raycast extension does not pre-validate — any check we do in the extension would become stale and misleading when the user's PATH differs between Raycast's subshell and their Terminal.

**[Risk] Opportunistic sweep is eventually-consistent, not immediate**
→ Accepted. The Manage Profiles List provides "Clean Up Stale Profiles" for manual on-demand cleanup. In practice the delay between Chromium close and cleanup is on the order of minutes for active users.

**[Risk] `trash` CLI not installed on all user systems**
→ Mitigation: `fs.rm` fallback + one-time toast ("`trash` CLI not found — deleting permanently"). Users who care about recoverable deletes can install `brew install trash`.

**[Risk] `ps` output parsing drifts across macOS versions**
→ Mitigation: use the stable `ps -Ao args=` invocation (POSIX compliant, header-less). Match on the exact substring `--user-data-dir=<absolute-path>` — the flag form is fixed by Chromium.

**[Risk] Google API keys embedded in extension source**
→ Same risk as the CLI (Debian-origin, publicly known, ToS-questionable). Out of scope for this change. If the extension is ever published to the Raycast Store, revisit: make the keys an optional extension preference (empty default → Google features off).

**[Trade-off] Install action leaves Raycast and opens a separate Terminal window**
→ Accepted. Install is rare (maybe once a month for updates). Terminal's native progress output is strictly better than any Detail-view approximation. Users already expect Terminal for development tasks on macOS.

**[Trade-off] Auto-cleanup "feels" slower than CLI's trap-based cleanup**
→ Accepted. Documented honestly. The UX label ("Auto-Cleanup After Close") matches the CLI's label; the mechanism differs but the user-visible outcome (profile eventually goes away) is the same.
