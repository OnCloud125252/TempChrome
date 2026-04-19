## REMOVED Requirements

### Requirement: Install action delegates to the CLI via Terminal.app
**Reason**: The install flow no longer trampolines through Terminal.app. All install work happens inside the Raycast extension process via the native TypeScript installer (`src/chromium/installer.ts`) rendered in a `<Detail>` view (`src/install/InstallView.tsx`).

**Migration**: Users who previously relied on the Terminal prompt for visible install progress will now see the same information inside the Raycast `<Detail>` view (stage, revision, bytes downloaded, progress bar). Users who invoked `tempchrome --install` directly from a shell must switch to the Raycast command; the shell subcommand has been removed.

### Requirement: Install action performs no pre-validation of the CLI
**Reason**: There is no CLI dependency anymore. The extension performs its own preflight (validating the install target directory and checking for running Chromium processes) directly.

### Requirement: Install action executes no Chromium-related I/O inside the extension
**Reason**: This requirement deliberately forbade the very pattern we now adopt. The install flow now performs `fetch`, `unzip` (via `/usr/bin/unzip` subprocess), `xattr` (via `/usr/bin/xattr` subprocess), `mv` / `fs.cp` / `fs.rename`, and `fs.rm` directly inside the extension process.

## ADDED Requirements

### Requirement: Install action pushes an in-extension Detail view
The system SHALL expose "Install or Update Chromium…" as a `List.Item` inside the `TempChrome` List command. Its primary action SHALL be an `Action.Push` whose `target` is the `<InstallView />` component. No Terminal.app, AppleScript, `osascript`, or external shell is invoked for the install flow.

#### Scenario: Primary action pushes InstallView
- **WHEN** the user triggers the primary action on "Install or Update Chromium…" in the TempChrome List
- **THEN** the system SHALL push the `<InstallView />` component via Raycast's `Action.Push`
- **AND** SHALL NOT call `execFile("osascript", ...)` or any subprocess named `osascript`, `open`, or `Terminal`
- **AND** SHALL NOT display a HUD or success toast prior to the install starting

#### Scenario: Shortcut is advertised via accessories
- **WHEN** the TempChrome List renders the "Install or Update Chromium…" item
- **THEN** the item's `accessories` SHALL include `{ tag: "⌘I" }`
- **AND** the `Action.Push` SHALL declare `shortcut={{ modifiers: ["cmd"], key: "i" }}`

### Requirement: Install runs entirely inside the Raycast extension process
The install pipeline SHALL execute inside the Raycast extension's Node/Bun process. It SHALL perform: revision lookup via `fetch`, streaming zip download via `fetch` + `fs.createWriteStream`, extraction via `/usr/bin/unzip` subprocess, existing-bundle removal via `fs.promises.rm`, new-bundle placement via `fs.rename` (with `fs.cp` + `fs.rm` fallback on `EXDEV`), quarantine clearing via `/usr/bin/xattr` subprocess, and tmp cleanup via `fs.promises.rm`. No `osascript` call is made at any point of the install flow.

#### Scenario: Subprocess usage is limited to unzip and xattr
- **WHEN** the install pipeline runs end-to-end
- **THEN** the only `child_process.spawn` / `execFile` calls the pipeline makes SHALL be to `/usr/bin/unzip` (exactly once for extraction), to `/usr/bin/xattr` (exactly once for quarantine clearing), and to whatever process-listing primitive `isChromiumBinaryRunning()` uses internally (`ps`) to detect running Chromium instances.

#### Scenario: Partial download safety
- **WHEN** the streaming download is interrupted (network error, user cancel, process kill)
- **THEN** no file named `chrome-mac.zip` (without the `.part` suffix) SHALL remain in `os.tmpdir()`
- **AND** the final path `appBundlePath` SHALL remain unchanged (either still the previous bundle or still absent)

### Requirement: Install target is derived from the `chromiumPath` preference
The install pipeline SHALL compute the destination `.app` bundle path by calling `appBundleFromBinary(prefs.chromiumPath)`. It SHALL NOT hardcode `/Applications/Chromium.app`. The parent directory of the derived `.app` bundle SHALL be created recursively via `fs.mkdir({ recursive: true })` if it does not already exist.

#### Scenario: Default preference produces `~/Applications/Chromium.app`
- **WHEN** the user has not set a custom `chromiumPath` in Raycast Preferences
- **AND** the user's home directory is `/Users/alice`
- **THEN** the install SHALL write the new app bundle to `/Users/alice/Applications/Chromium.app`
- **AND** SHALL create `/Users/alice/Applications/` if it does not already exist

#### Scenario: Custom preference overrides install location
- **WHEN** the user has set `chromiumPath` to `/Applications/Chromium.app/Contents/MacOS/Chromium` in Raycast Preferences
- **THEN** the install SHALL write the new app bundle to `/Applications/Chromium.app`

### Requirement: Install refuses to run when Chromium is running at the target binary
Before the swap step, and again immediately before deleting any existing `.app` at the target path, the pipeline SHALL call `isChromiumBinaryRunning(prefs.chromiumPath)`. If it returns `true`, the pipeline SHALL throw a typed `ChromiumRunningError` and the `InstallView` SHALL render a failure toast titled `"Chromium is running"` with a message directing the user to quit Chromium and try again. No files under the target `.app` bundle SHALL be modified.

#### Scenario: Running Chromium blocks install at preflight
- **WHEN** the user triggers the install
- **AND** a Chromium process whose executable matches `prefs.chromiumPath` is running at preflight time
- **THEN** the pipeline SHALL reject with `ChromiumRunningError`
- **AND** `showFailureToast` SHALL be called with `{ title: "Chromium is running" }`
- **AND** no `fs.rm`, `fs.rename`, `fs.cp`, or `unzip` call SHALL have run for the install's destination paths

#### Scenario: Running Chromium detected at swap time
- **WHEN** preflight passed, but between preflight and the swap step a Chromium process matching `prefs.chromiumPath` started
- **THEN** the pipeline SHALL reject with `ChromiumRunningError` before calling `fs.rm(appBundlePath, ...)`
- **AND** the extracted tmp directory SHALL be cleaned up in the pipeline's `finally` block

### Requirement: Install reports live progress and is cancellable
The `<InstallView />` component SHALL render a `<Detail>` showing the current stage (`resolve-revision` / `download` / `extract` / `preflight` / `swap` / `xattr` / `cleanup` / `done`) and, during the `download` stage, a progress bar and byte counts. Progress state updates SHALL be throttled so `setState` is called at most when the stage changes OR when `bytesDownloaded` has advanced ≥ 1 % of `bytesTotal` OR when ≥ 250 ms have elapsed since the last update, whichever comes first. The `ActionPanel` SHALL expose a **Cancel** action bound to `⌘.` while the install is in progress. Activating Cancel SHALL call `abortController.abort()`; the pipeline SHALL respond by throwing `AbortedError` at its next `await` boundary and SHALL run its cleanup `finally` block.

#### Scenario: Progress bar reflects bytes downloaded
- **WHEN** the install is in the `download` stage
- **AND** `bytesTotal` is a known positive number
- **THEN** the rendered markdown SHALL include a fixed-width 20-character bar of `▓` and `░` characters whose filled segment count is `floor(20 * bytesDownloaded / bytesTotal)`
- **AND** the text `"<mb>.<tenth> / <total>.<tenth> MB"` SHALL appear next to the bar

#### Scenario: Cancel during download
- **WHEN** the install is in the `download` stage
- **AND** the user triggers the Cancel action (⌘.)
- **THEN** `abortController.abort()` SHALL be called
- **AND** the in-flight `fetch` SHALL reject with a `DOMException` of name `"AbortError"`, which the pipeline SHALL rewrap as `AbortedError`
- **AND** `showFailureToast` SHALL be called with `{ title: "Install cancelled" }`
- **AND** the `.part` temp file SHALL be removed by the pipeline's `finally` block

#### Scenario: Cancel during extraction
- **WHEN** the install is in the `extract` stage
- **AND** the user triggers the Cancel action
- **THEN** the `unzip` child process SHALL be killed via `.kill()`
- **AND** the partially-extracted tmp directory SHALL be removed
- **AND** the target `.app` bundle SHALL remain unchanged
