# quick-launch Specification

## Purpose
TBD - created by archiving change raycast-extension. Update Purpose after archive.
## Requirements
### Requirement: Chromium binary path preference
The system SHALL read the Chromium binary path from a Raycast extension-level preference named `chromiumPath` with default value `~/Applications/Chromium.app/Contents/MacOS/Chromium`. The `getPreferences()` helper SHALL expand a leading `~` or `~/` in both `chromiumPath` and `tempBaseDir` to the user's home directory (`os.homedir()`) before returning the preference object. All downstream code (launcher, installer, log viewer, profile manager) SHALL receive only absolute paths.

#### Scenario: Default `chromiumPath` resolves under `~/Applications`
- **WHEN** the user has not set `chromiumPath` in Raycast Preferences
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().chromiumPath` SHALL return `/Users/alice/Applications/Chromium.app/Contents/MacOS/Chromium`
- **AND** all Chromium spawn and existence-check operations SHALL use this resolved path

#### Scenario: Custom `chromiumPath` with a leading tilde is expanded
- **WHEN** the user sets `chromiumPath` to `~/bin/chromium-dev/Chromium.app/Contents/MacOS/Chromium`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().chromiumPath` SHALL return `/Users/alice/bin/chromium-dev/Chromium.app/Contents/MacOS/Chromium`

#### Scenario: Absolute `chromiumPath` is passed through unchanged
- **WHEN** the user sets `chromiumPath` to `/Applications/Thorium.app/Contents/MacOS/Thorium`
- **THEN** `getPreferences().chromiumPath` SHALL return `/Applications/Thorium.app/Contents/MacOS/Thorium` unchanged

#### Scenario: `tempBaseDir` tilde expansion
- **WHEN** the user sets `tempBaseDir` to `~/tempchrome`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().tempBaseDir` SHALL return `/Users/alice/tempchrome`

### Requirement: No-view command launches Chromium with a fresh temporary profile
The system SHALL expose a Raycast command named "Launch TempChrome" with `mode: "no-view"` that creates a new temporary profile directory, spawns Chromium with that profile, observes the spawned process for an early-crash grace window, triggers the opportunistic auto-cleanup sweep, and shows a HUD. The command SHALL render no Raycast UI beyond the HUD (with the exception of the failure toast produced by an early-crash detection, described below). The same behavior SHALL also be reachable as the "Launch Now" action inside the `TempChrome` List command.

During the grace window the command SHALL await the result of `launchChromium(...)`. Callers SHALL show an animated `Toast` / `HUD` state (e.g. `"Launching TempChrome…"`) before awaiting and transition to the success or failure state based on the returned promise. `launchChromium` SHALL resolve successfully if the spawned Chromium child is still alive when the grace window elapses, and SHALL reject if the child emits `exit` (with any code) or `error` during the window.

#### Scenario: Successful quick launch
- **WHEN** the user invokes "Launch TempChrome" (or triggers the "Launch Now" action inside the TempChrome List command)
- **THEN** the system SHALL read `chromiumPath` and `tempBaseDir` from extension preferences
- **AND** verify that the file at `chromiumPath` is accessible with `fs.constants.X_OK`
- **AND** ensure the directory at `tempBaseDir` exists with mode `0o700` (creating it if necessary)
- **AND** create a new directory at `<tempBaseDir>/<id>` where `<id>` is a 10-character string drawn from `a-z0-9`, with mode `0o700`
- **AND** clear macOS quarantine attributes on the Chromium `.app` bundle via `execFile("xattr", ["-cr", <appBundlePath>])`, swallowing any error
- **AND** spawn Chromium via `child_process.spawn(chromiumPath, args, { detached: true, stdio: "ignore", env })`
- **AND** observe the child for `exit` and `error` events for a grace window of `750` ms
- **AND** if the child is still alive at the end of the window, call `child.unref()` and resolve the launch promise
- **AND** the `args` passed to `spawn` SHALL be `["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=<profileDir>", "--enable-logging=stderr", "--log-file=<profileDir>/chrome_debug.log", ...extraArgs]`
- **AND** the `--log-file` value SHALL be computed at launch time by joining the freshly created `<profileDir>` with the filename `chrome_debug.log` using `node:path.join`
- **AND** the `env` passed to `spawn` SHALL be `{ ...process.env, GOOGLE_API_KEY: "AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k", GOOGLE_DEFAULT_CLIENT_ID: "811574891467.apps.googleusercontent.com", GOOGLE_DEFAULT_CLIENT_SECRET: "kdloedMFGdGla2P1zacGjAQh" }`
- **AND** invoke the opportunistic auto-cleanup sweep as a fire-and-forget async call (see separate requirement)
- **AND** show a HUD with text `"Launched"` (or the richer HUD produced by `launchWithValues`)

#### Scenario: Chromium binary missing
- **WHEN** the user invokes "Launch TempChrome"
- **AND** the file at `chromiumPath` is not accessible (does not exist, is not a regular file, or lacks execute permission)
- **THEN** the system SHALL call `showFailureToast` with title `"Chromium not found"` and message `"Run 'Install or Update Chromium' from the TempChrome command to install it."`
- **AND** SHALL NOT create any temp profile directory
- **AND** SHALL NOT spawn any process

#### Scenario: Chromium crashes inside the grace window
- **WHEN** the user invokes "Launch TempChrome"
- **AND** the spawned child emits `exit` with code `1` within `750` ms
- **THEN** `launchChromium` SHALL reject with a typed `ChromiumLaunchFailedError` whose message includes the exit code and (if captured) exit signal
- **AND** the caller SHALL call `showFailureToast` with title `"Launch failed"`
- **AND** the caller SHALL NOT show the success HUD
- **AND** the created temp profile directory SHALL remain on disk (no automatic cleanup in the failure path)

#### Scenario: Chromium spawn error
- **WHEN** the user invokes "Launch TempChrome"
- **AND** the spawned child emits `error` (e.g. `ENOENT` at exec time) within the grace window
- **THEN** `launchChromium` SHALL reject with the underlying error
- **AND** the caller SHALL call `showFailureToast` with title `"Launch failed"`

#### Scenario: Chromium is still alive at the end of the grace window
- **WHEN** the spawned child has not emitted `exit` or `error` `750` ms after spawn
- **THEN** the `exit` and `error` listeners SHALL be removed
- **AND** `child.unref()` SHALL be called
- **AND** `launchChromium` SHALL resolve successfully

#### Scenario: Caller shows a loading state during the grace window
- **WHEN** the user invokes "Launch Now" from the root `TempChrome` List view
- **THEN** the caller SHALL call `showToast({ style: Toast.Style.Animated, title: "Launching TempChrome…" })` before awaiting `launchWithValues(...)`
- **AND** upon a resolved promise, the animated toast SHALL be hidden and replaced with the success HUD (or hidden if the caller uses `popToRoot`)
- **AND** upon a rejected promise, the caller SHALL transition the toast to `Toast.Style.Failure` with title `"Launch failed"`

#### Scenario: Log file lifetime is tied to the profile directory
- **WHEN** a successful quick launch has occurred
- **THEN** Chromium SHALL write diagnostic output to `<profileDir>/chrome_debug.log` (via `--log-file`) and also to stderr (via `--enable-logging=stderr`)
- **AND** the log file SHALL reside inside the profile directory, inheriting its `0o700` permissions
- **AND** no separate log directory (for example `~/Library/Logs/TempChrome/`) SHALL be created by the extension

### Requirement: Temporary profile uses collision-resistant random IDs
The system SHALL generate profile directory names using exactly 10 characters drawn from the charset `abcdefghijklmnopqrstuvwxyz0123456789`. The system SHALL attempt `mkdir` atomically and retry on `EEXIST`, failing after 100 consecutive attempts.

#### Scenario: Profile directory is created atomically
- **WHEN** the system creates a new temporary profile directory
- **THEN** it SHALL generate a random 10-character ID from the charset above
- **AND** attempt `fs.promises.mkdir(path, { mode: 0o700 })`
- **AND** catch errors with `code === "EEXIST"` and retry with a freshly generated ID
- **AND** propagate errors with any other code
- **AND** throw after 100 consecutive `EEXIST` failures with message `"Failed to create unique profile directory after 100 attempts"`

### Requirement: Temp base directory is configurable via extension preferences
The system SHALL read the temp profile base directory from a Raycast extension-level preference named `tempBaseDir` with default value `/tmp/tempchrome_profile`.

#### Scenario: Default temp base directory
- **WHEN** the user has not set `tempBaseDir` in Raycast Preferences
- **THEN** the system SHALL create all temp profiles under `/tmp/tempchrome_profile`
- **AND** create `/tmp/tempchrome_profile` with mode `0o700` if it does not already exist

#### Scenario: Custom temp base directory
- **WHEN** the user has set `tempBaseDir` to `/Users/<user>/.tempchrome/profiles` in Raycast Preferences
- **THEN** the system SHALL create all temp profiles under that directory
- **AND** create the directory with mode `0o700` if it does not exist

### Requirement: Opportunistic auto-cleanup sweep runs after every launch
The system SHALL, after successfully spawning Chromium, invoke an asynchronous sweep that trashes every profile in the auto-cleanup registry whose Chromium process is no longer running. The sweep SHALL be fire-and-forget — the command SHALL NOT `await` it. Sweep failures SHALL NOT block the originating launch's HUD or failure toast. Sweep failures SHALL surface through `reportError("Auto-cleanup sweep failed", error)` (from the `error-reporting` capability), which renders a non-blocking failure toast; they SHALL NOT be silently swallowed.

#### Scenario: Stale auto-cleanup profile is trashed
- **WHEN** the sweep runs
- **AND** the registry at `LocalStorage` key `"tempchrome.auto-cleanup-registry"` contains an entry `P → <timestamp>`
- **AND** the output of `execFile("ps", ["-Ao", "args="])` contains no line with the substring `"--user-data-dir=" + P`
- **THEN** the system SHALL call `execFile("trash", [P])`
- **AND** remove key `P` from the registry
- **AND** write the updated registry back to `LocalStorage`

#### Scenario: In-use auto-cleanup profile is preserved
- **WHEN** the sweep runs
- **AND** the registry contains an entry `P → <timestamp>`
- **AND** the output of `ps -Ao args=` contains at least one line with the substring `"--user-data-dir=" + P`
- **THEN** the system SHALL NOT delete `P`
- **AND** SHALL leave the registry entry intact

#### Scenario: Sweep errors surface via reportError
- **WHEN** the sweep runs
- **AND** any operation fails (e.g., `ps` fails, `trash` fails, `LocalStorage` is unavailable, or JSON parse of the registry fails)
- **THEN** the system SHALL catch the error
- **AND** SHALL call `reportError("Auto-cleanup sweep failed", error)` — which logs and shows a non-blocking failure toast
- **AND** the HUD from the originating launch command SHALL still have been shown
- **AND** the launch's success state SHALL NOT be downgraded to failure

#### Scenario: Sweep does not block launch
- **WHEN** the launch command triggers the sweep
- **THEN** the sweep SHALL be invoked as a non-awaited async call (fire-and-forget)
- **AND** the originating command SHALL call `showHUD` and return without waiting for the sweep to complete

### Requirement: Auto-cleanup registry writes are serialized
The auto-cleanup registry SHALL be mutated exclusively through an `updateRegistry(mutator: (current: Registry) => Registry): Promise<Registry>` primitive exposed by `raycast/src/profiles/autoCleanup.ts`. The module SHALL maintain a single in-memory promise chain; each invocation of `updateRegistry` SHALL `await` the previous chain link before reading from `LocalStorage`, applying the mutator, and writing back. No code in `raycast/src/**` SHALL call `LocalStorage.setItem(AUTO_CLEANUP_REGISTRY_KEY, ...)` directly; all writes SHALL flow through `updateRegistry`.

#### Scenario: Two concurrent `markForAutoCleanup` calls both persist
- **WHEN** two Quick Launches both call `markForAutoCleanup(pathA)` and `markForAutoCleanup(pathB)` simultaneously
- **THEN** after both promises resolve, the persisted registry SHALL contain both `pathA` and `pathB` as keys
- **AND** the two writes SHALL be linearized by the in-module promise chain such that the second `updateRegistry` reads a registry that already includes the first's result

#### Scenario: Concurrent sweep + mark do not lose entries
- **WHEN** a sweep is in progress (reading the registry and removing entry `pathOld`)
- **AND** a new launch calls `markForAutoCleanup(pathNew)` before the sweep's `updateRegistry` resolves
- **THEN** the `markForAutoCleanup` call SHALL wait for the sweep's `updateRegistry` to complete
- **AND** the final persisted registry SHALL contain `pathNew` (and SHALL NOT contain `pathOld`)

#### Scenario: All registry accessors go through the primitive
- **WHEN** a reviewer greps `raycast/src/**` for `LocalStorage.setItem` with the `AUTO_CLEANUP_REGISTRY_KEY` key
- **THEN** the only match SHALL be inside the body of `updateRegistry` within `raycast/src/profiles/autoCleanup.ts`

#### Scenario: unmarkAutoCleanup uses updateRegistry
- **WHEN** `unmarkAutoCleanup(path)` runs
- **THEN** it SHALL call `updateRegistry((current) => { const next = { ...current }; delete next[path]; return next; })`
- **AND** SHALL NOT call `readRegistry`-then-`writeRegistry` as two separate operations
