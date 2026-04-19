## Why

The current "Install or Update Chromium…" action trampolines through Terminal.app: Raycast fires `osascript` → Terminal window opens → shell runs `tempchrome --install`, which calls `curl` + `unzip` + `xattr`. The Terminal hop exists only to borrow a visible `curl --progress-bar`; it costs users a focus switch, a second app window, an AppleScript automation prompt on fresh systems, and silent-fail modes when AppleScript is denied. Nothing about the install actually needs a TTY — `/Applications` is user-writable, no `sudo` is required, and the shell script itself does nothing that Node/Bun cannot do directly.

Additionally, the default install target (`/Applications/Chromium.app`) clobbers any existing upstream Chromium the user may already have installed for other purposes. Relocating the default to a TempChrome-owned path keeps the extension's installer isolated from the user's general-purpose Chromium.

## What Changes

- Replace the Terminal-delegating install action with a **native TypeScript installer** that runs entirely inside the Raycast extension process.
- Implement the installer as a pure `runInstall({ onProgress, signal })` module in `src/chromium/installer.ts`, and wrap it in a Raycast `<Detail>` view (`src/install/InstallView.tsx`) that shows live stage, percentage, revision, and byte counts.
- Expose a **Cancel** action (`⌘.`) in the install view, backed by a single `AbortController` that cancels both the streaming download and any in-flight subprocess.
- Use `fetch()` for `LAST_CHANGE` lookup and streaming zip download; pipe the streaming body to `fs.createWriteStream(<zipPath>.part)`, rename to the final path on success (atomic partial-download hygiene).
- Use `spawn("/usr/bin/unzip", ["-oq", zipPath, "-d", extractDir])` for extraction — macOS ships `unzip` as a base-system binary. No new npm dependencies.
- Use `spawn("/usr/bin/xattr", ["-cr", appBundlePath])` to clear Gatekeeper quarantine after install. No Node-native API for extended attributes on macOS.
- Use `fs.promises.rm(appBundlePath, { recursive: true, force: true })` to delete any existing app bundle at the target path. This is a permanent delete, per repo rule (`CLAUDE.md`: TS/JS code uses `fs.promises.rm`, overrides the `trash` rule).
- Before starting the install, **refuse if any Chromium process is running against the target bundle** — reuse the existing `isProfileInUse()`-style process detection in `src/chromium/processes.ts` to find any running Chromium whose executable matches the target path, and surface a failure toast with a clear action hint ("Quit Chromium and try again").
- **Relocate the default install target** from `/Applications/Chromium.app/Contents/MacOS/Chromium` to `~/Applications/Chromium.app/Contents/MacOS/Chromium`. Derive the `.app` bundle path from the `chromiumPath` preference at runtime via the existing `appBundleFromBinary()` helper, so the installer always writes to whatever path the user has configured.
- Expand a leading `~` in `chromiumPath` and `tempBaseDir` preferences inside `src/preferences.ts` via `os.homedir()`, since Raycast does not expand `~` itself.
- **Completely remove the `--install` and `--update` subcommands from `cli/tempchrome.sh`.** Delete the `install_chromium()` function, the case branches, and the `--install` mention from `usage()`. Update the "Chromium not found" hint in the script to point users at the Raycast **Install or Update Chromium** command instead of `tempchrome --install`.
- Update the root `README.md` to reflect Raycast-only installation (no CLI install step).

## Capabilities

### Modified Capabilities

- `chromium-installer`: Every existing requirement is replaced. The install action no longer invokes `osascript`, opens Terminal.app, or depends on the `tempchrome` CLI. All install I/O (network fetch, disk write, extraction, quarantine clear, app swap) now runs inside the Raycast extension process. A new `<Detail>` view replaces the HUD-only feedback.
- `quick-launch`: The default value of the `chromiumPath` preference changes from `/Applications/Chromium.app/Contents/MacOS/Chromium` to `~/Applications/Chromium.app/Contents/MacOS/Chromium`. The extension SHALL expand a leading `~` before using the path.

## Impact

- **Raycast source**
  - New: `raycast/src/chromium/installer.ts` (pure install logic, no Raycast UI) and `raycast/src/install/InstallView.tsx` (the `<Detail>` wrapper).
  - Modified: `raycast/src/Tempchrome.tsx` — the "Install or Update Chromium…" `List.Item` swaps its `Action onAction={handleInstall}` for an `Action.Push target={<InstallView />}`.
  - Modified: `raycast/src/preferences.ts` — tilde-expansion for `chromiumPath` and `tempBaseDir`.
  - Modified: `raycast/src/chromium/launcher.ts` — `appBundleFromBinary` is re-exported / reused by the installer (no new logic, just reuse).
  - Modified: `raycast/src/chromium/processes.ts` — add a helper `isChromiumBinaryRunning(chromiumPath: string): Promise<boolean>` that checks whether any running process has the given binary path as its executable (distinct from the existing `isProfileInUse(profileDir)` which keys on `--user-data-dir`).
  - Modified: `raycast/package.json` — default for the `chromiumPath` preference changes to `~/Applications/Chromium.app/Contents/MacOS/Chromium`.
- **CLI script** — `cli/tempchrome.sh` loses the entire `install_chromium()` function, the `--install|--update` case branches, the `--install` entry in `usage()`, and the SNAPSHOT-related section header comments. The "Chromium not found" error message is reworded to point at the Raycast command.
- **Root README** — install instructions are rewritten to describe the Raycast path only. Any reference to `tempchrome --install` is removed.
- **No new dependencies** — `fetch` is built into Node ≥ 18 and Bun. `unzip` and `xattr` are macOS base-system binaries.
- **Breaking change for CLI-only users**: anyone who previously relied on `tempchrome --install` from a terminal will need to run the Raycast command instead. The root `README.md` will call this out explicitly. Since the project's distribution channel is Raycast, the practical impact is low.
- **Breaking change for existing installs at `/Applications/Chromium.app`**: the installer no longer writes there by default. Users with a working `/Applications/Chromium.app` from a previous TempChrome install will either (a) update the `chromiumPath` preference to point back at it, or (b) re-install via the new flow, which will populate `~/Applications/Chromium.app` instead. Both paths are documented in the install view and README.
- **Security** — no outbound network changes; the installer hits the same `storage.googleapis.com/chromium-browser-snapshots/...` URLs as the shell script. Writes occur only inside `/tmp/` (staging) and the user-configured `chromiumPath` parent directory.
