## MODIFIED Requirements

### Requirement: Install target is derived from the `chromiumInstallDir` preference
The install pipeline SHALL read the destination `.app` bundle path from `getPreferences().appBundlePath`, which is computed once as `path.join(installDir, "Chromium.app")` where `installDir = expandTilde(chromiumInstallDir)`. It SHALL NOT call `appBundleFromBinary(...)` or any other helper that parses a binary path to recover the bundle root. It SHALL NOT hardcode `/Applications/Chromium.app`. The parent directory of the derived `.app` bundle (i.e. `installDir`) SHALL be created recursively via `fs.mkdir({ recursive: true })` if it does not already exist.

#### Scenario: Default preference produces `~/Applications/Chromium.app`
- **WHEN** the user has not set a custom `chromiumInstallDir` in Raycast Preferences
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().appBundlePath` SHALL return `/Users/alice/Applications/Chromium.app`
- **AND** the install SHALL write the new app bundle to `/Users/alice/Applications/Chromium.app`
- **AND** SHALL create `/Users/alice/Applications/` if it does not already exist

#### Scenario: Custom preference overrides install location
- **WHEN** the user has set `chromiumInstallDir` to `/Applications` in Raycast Preferences
- **THEN** `getPreferences().appBundlePath` SHALL return `/Applications/Chromium.app`
- **AND** the install SHALL write the new app bundle to `/Applications/Chromium.app`

#### Scenario: Tilde in the preference is expanded
- **WHEN** the user has set `chromiumInstallDir` to `~/Dev/browsers`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().installDir` SHALL return `/Users/alice/Dev/browsers`
- **AND** `getPreferences().appBundlePath` SHALL return `/Users/alice/Dev/browsers/Chromium.app`

### Requirement: Install refuses to run when Chromium is running at the target binary
Before the swap step, and again immediately before deleting any existing `.app` at the target path, the pipeline SHALL call `isChromiumBinaryRunning(prefs.binaryPath)`. The implementation SHALL match the configured `binaryPath` against each `ps` line using a path-prefix comparison that tolerates install paths containing spaces (e.g. `/Users/alice/Applications/My Installs/Chromium.app/Contents/MacOS/Chromium` when `chromiumInstallDir = ~/Applications/My Installs`); it SHALL NOT use `line.split(/\s+/)[0]` or any other strategy that assumes the executable path contains no spaces. If `isChromiumBinaryRunning` returns `true`, the pipeline SHALL throw a typed `ChromiumRunningError` and the `InstallView` SHALL render a failure toast titled `"Chromium is running"` with a message directing the user to quit Chromium and try again. No files under the target `.app` bundle SHALL be modified.

#### Scenario: Running Chromium blocks install at preflight
- **WHEN** the user triggers the install
- **AND** a Chromium process whose executable matches `prefs.binaryPath` is running at preflight time
- **THEN** the pipeline SHALL reject with `ChromiumRunningError`
- **AND** `showFailureToast` SHALL be called with `{ title: "Chromium is running" }`
- **AND** no `fs.rm`, `fs.rename`, `fs.cp`, or `unzip` call SHALL have run for the install's destination paths

#### Scenario: Running Chromium detected at swap time
- **WHEN** preflight passed, but between preflight and the swap step a Chromium process matching `prefs.binaryPath` started
- **THEN** the pipeline SHALL reject with `ChromiumRunningError` before calling `fs.rm(appBundlePath, ...)`
- **AND** the extracted tmp directory SHALL be cleaned up in the pipeline's `finally` block

#### Scenario: Detection works for install paths containing spaces
- **WHEN** the user's `chromiumInstallDir` is `/Applications/My Installs`
- **AND** therefore `prefs.binaryPath` is `/Applications/My Installs/Chromium.app/Contents/MacOS/Chromium`
- **AND** a process with argv `/Applications/My Installs/Chromium.app/Contents/MacOS/Chromium --type=renderer` appears in `ps` output
- **THEN** `isChromiumBinaryRunning(prefs.binaryPath)` SHALL return `true`
- **AND** the install pipeline SHALL reject with `ChromiumRunningError`

#### Scenario: Detection does not false-positive on prefix paths
- **WHEN** the user's `chromiumInstallDir` is `/Applications`
- **AND** therefore `prefs.binaryPath` is `/Applications/Chromium.app/Contents/MacOS/Chromium`
- **AND** the only running process has argv `/Applications/Chromium.app.old/Contents/MacOS/Chromium --type=renderer`
- **THEN** `isChromiumBinaryRunning` SHALL return `false`
- **AND** the install pipeline SHALL proceed

## REMOVED Requirements

### Requirement: InstallView renders safely when chromiumPath is malformed
**Reason**: The `chromiumPath` preference is replaced by `chromiumInstallDir`, which is a directory. `getPreferences()` derives `appBundlePath` via `path.join(installDir, "Chromium.app")` — this always produces a well-formed string, even when `installDir` points at a nonexistent directory. There is no longer a parsing step that can throw at render time, so the `useMemo` + discriminated-union guard in `<InstallView />` has no failure to catch. Bad directory values surface at install time through existing network / extraction / permission failure paths (e.g. `ensureParentDir` throws `InstallPathError` with a clear message) rather than at render time.

**Migration**: None for end-users; the failure mode this requirement guarded against is eliminated by construction. Code-level migration: delete the `AppBundleResolution` discriminated union, the `badPathError` state, the `"Invalid Chromium Path"` `<Detail>` branch, and the `useEffect` that fires `showFailureToast` with title `"Invalid Chromium path"` from `raycast/src/install/InstallView.tsx`.
