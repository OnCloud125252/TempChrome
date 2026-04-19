## MODIFIED Requirements

### Requirement: Install refuses to run when Chromium is running at the target binary
Before the swap step, and again immediately before deleting any existing `.app` at the target path, the pipeline SHALL call `isChromiumBinaryRunning(prefs.chromiumPath)`. The implementation SHALL match the configured `chromiumPath` against each `ps` line using a path-prefix comparison that tolerates install paths containing spaces (e.g. `/Applications/My Chromium.app/Contents/MacOS/Chromium`); it SHALL NOT use `line.split(/\s+/)[0]` or any other strategy that assumes the executable path contains no spaces. If `isChromiumBinaryRunning` returns `true`, the pipeline SHALL throw a typed `ChromiumRunningError` and the `InstallView` SHALL render a failure toast titled `"Chromium is running"` with a message directing the user to quit Chromium and try again. No files under the target `.app` bundle SHALL be modified.

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

#### Scenario: Detection works for install paths containing spaces
- **WHEN** the user's `chromiumPath` is `/Applications/My Chromium.app/Contents/MacOS/Chromium`
- **AND** a process with argv `/Applications/My Chromium.app/Contents/MacOS/Chromium --type=renderer` appears in `ps` output
- **THEN** `isChromiumBinaryRunning("/Applications/My Chromium.app/Contents/MacOS/Chromium")` SHALL return `true`
- **AND** the install pipeline SHALL reject with `ChromiumRunningError`

#### Scenario: Detection does not false-positive on prefix paths
- **WHEN** the user's `chromiumPath` is `/Applications/Chromium.app/Contents/MacOS/Chromium`
- **AND** the only running process has argv `/Applications/Chromium.app.old/Contents/MacOS/Chromium --type=renderer`
- **THEN** `isChromiumBinaryRunning` SHALL return `false`
- **AND** the install pipeline SHALL proceed

## ADDED Requirements

### Requirement: Download resumes across interrupted installs via HTTP Range
The installer SHALL keep the in-flight `.part` file on the filesystem when an install is aborted or fails before the rename step, and SHALL resume the next install attempt by issuing a `Range: bytes=N-` request to the snapshot URL, where `N` is the current size in bytes of the existing `.part` file. The `.part` filename SHALL encode the platform (`Mac` or `Mac_Arm`) and revision so that a moved `LAST_CHANGE` naturally invalidates stale parts. On startup of a fresh install, the pipeline SHALL prune any part files in `os.tmpdir()` matching the install's prefix but targeting a different platform or revision. The `.part` file SHALL only be deleted when the install completes successfully (after the rename to the final `.zip` path).

#### Scenario: Interrupted download is resumed on the next attempt
- **WHEN** a prior install of revision `R` downloaded `50000000` bytes before the user cancelled
- **AND** the user triggers the install again while `LAST_CHANGE` still returns revision `R`
- **THEN** the pipeline SHALL issue `fetch(zipUrl, { headers: { Range: "bytes=50000000-" }, signal })`
- **AND** a `206 Partial Content` response SHALL be appended to the existing `.part` file (opened with `flags: "a"`)
- **AND** the `onProgress` callback SHALL report `bytesDownloaded` starting at `50000000`

#### Scenario: Server ignores range header and returns 200
- **WHEN** the pipeline issues a `Range: bytes=N-` request
- **AND** the server responds with `200 OK` (ignoring the range)
- **THEN** the existing `.part` file SHALL be truncated to zero bytes before piping the response
- **AND** the `onProgress` callback SHALL report `bytesDownloaded` starting at `0`

#### Scenario: Server returns 416 Range Not Satisfiable
- **WHEN** the pipeline issues a `Range: bytes=N-` request and receives `416 Range Not Satisfiable`
- **THEN** the existing `.part` file SHALL be deleted
- **AND** the pipeline SHALL retry the download without a `Range` header exactly once
- **AND** if that retry also fails, a `NetworkError` SHALL be thrown

#### Scenario: Stale part from a different revision is pruned
- **WHEN** the tmpdir contains `tempchrome-install-Mac_Arm-1000.zip.part` from an earlier install
- **AND** the current install resolves `LAST_CHANGE` to revision `1050` on `Mac_Arm`
- **THEN** the pipeline SHALL delete `tempchrome-install-Mac_Arm-1000.zip.part` before starting the current download
- **AND** SHALL NOT delete `tempchrome-install-Mac_Arm-1050.zip.part` if it exists

#### Scenario: Part file survives cancellation
- **WHEN** the user triggers Cancel (⌘.) during the `download` stage of revision `R`
- **THEN** the `.part` file for revision `R` SHALL remain on disk after the pipeline's `finally` block runs
- **AND** the `.zip` file (without the `.part` suffix) SHALL NOT exist
- **AND** the extraction tmp directory SHALL have been removed

#### Scenario: Part file is deleted on success
- **WHEN** the install completes the `done` stage
- **THEN** the `.part` file SHALL no longer exist on disk
- **AND** the `.zip` file SHALL also no longer exist (cleaned up in the `cleanup` stage)

### Requirement: InstallView renders safely when chromiumPath is malformed
The `<InstallView />` component SHALL compute its target `.app` bundle path inside a guarded block (e.g. a `useMemo` with try/catch). If `appBundleFromBinary(prefs.chromiumPath)` throws (because the configured path contains no `.app` segment), the component SHALL render a failure `<Detail>` explaining that the `chromiumPath` preference must point to a file inside a `.app` bundle, and SHALL NOT start the install pipeline. The failure `<Detail>` SHALL expose a Close action and SHALL surface a `showFailureToast`.

#### Scenario: Malformed chromiumPath renders friendly error
- **WHEN** the user has set `chromiumPath` to `/usr/local/bin/chromium` (no `.app` segment)
- **AND** the user triggers "Install or Update Chromium…"
- **THEN** `<InstallView />` SHALL render without throwing
- **AND** the rendered markdown SHALL include the text `"chromiumPath must point to a file inside a .app bundle"`
- **AND** `runInstall(...)` SHALL NOT be invoked
- **AND** `showFailureToast` SHALL be called with `{ title: "Invalid Chromium path" }`

### Requirement: Swap-step failure clearly states the prior bundle is gone
If the destructive swap step fails after `fs.rm(appBundlePath, { recursive: true, force: true })` has run but before the new bundle is in place (for example `fs.rename` or the `EXDEV` `fs.cp` fallback rejects), the pipeline SHALL throw `InstallPathError` with a message that includes the text `"Chromium bundle at <appBundlePath> is no longer present."` and the `<InstallView />` failure state SHALL render remediation copy instructing the user to run **Install or Update Chromium…** again. The pipeline SHALL NOT attempt to restore the previous bundle.

#### Scenario: Rename fails after rm deleted the prior bundle
- **WHEN** the pipeline has executed `fs.rm(appBundlePath, ...)` at the swap step
- **AND** the subsequent `fs.rename(sourceApp, appBundlePath)` rejects with `EPERM`
- **THEN** the pipeline SHALL throw `InstallPathError`
- **AND** the thrown error's `message` SHALL include `"Chromium bundle at <appBundlePath> is no longer present."`
- **AND** the `<InstallView />` failure `<Detail>` SHALL render markdown that includes the line `"Your previous Chromium bundle has been removed. Run Install or Update Chromium… again to recover."`
- **AND** no backup or rollback SHALL be attempted
