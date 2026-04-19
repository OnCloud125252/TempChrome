## MODIFIED Requirements

### Requirement: Chromium install directory preference
The system SHALL read the Chromium install directory from a Raycast extension-level preference named `chromiumInstallDir` with default value `~/Applications`. The `getPreferences()` helper SHALL expand a leading `~` or `~/` in both `chromiumInstallDir` and `tempBaseDir` to the user's home directory (`os.homedir()`) before returning the preference object. It SHALL derive two additional absolute paths and return them on the preferences object:

- `appBundlePath = path.join(installDir, "Chromium.app")`
- `binaryPath    = path.join(appBundlePath, "Contents", "MacOS", "Chromium")`

Where `installDir` is the tilde-expanded value of `chromiumInstallDir`. All downstream code (launcher, installer, log viewer, profile manager) SHALL consume `appBundlePath` and/or `binaryPath` directly from the preferences object and SHALL NOT parse the binary path to recover the bundle root. The bundle name `Chromium.app` and executable name `Chromium` SHALL be hard-coded; there SHALL be no preference for overriding them.

#### Scenario: Default `chromiumInstallDir` resolves under `~/Applications`
- **WHEN** the user has not set `chromiumInstallDir` in Raycast Preferences
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().installDir` SHALL return `/Users/alice/Applications`
- **AND** `getPreferences().appBundlePath` SHALL return `/Users/alice/Applications/Chromium.app`
- **AND** `getPreferences().binaryPath` SHALL return `/Users/alice/Applications/Chromium.app/Contents/MacOS/Chromium`
- **AND** all Chromium spawn and existence-check operations SHALL use the resolved `binaryPath`

#### Scenario: Custom `chromiumInstallDir` with a leading tilde is expanded
- **WHEN** the user sets `chromiumInstallDir` to `~/bin/chromium-dev`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().installDir` SHALL return `/Users/alice/bin/chromium-dev`
- **AND** `getPreferences().binaryPath` SHALL return `/Users/alice/bin/chromium-dev/Chromium.app/Contents/MacOS/Chromium`

#### Scenario: Absolute `chromiumInstallDir` is passed through unchanged
- **WHEN** the user sets `chromiumInstallDir` to `/Applications`
- **THEN** `getPreferences().installDir` SHALL return `/Applications` unchanged
- **AND** `getPreferences().binaryPath` SHALL return `/Applications/Chromium.app/Contents/MacOS/Chromium`

#### Scenario: `tempBaseDir` tilde expansion
- **WHEN** the user sets `tempBaseDir` to `~/tempchrome`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().tempBaseDir` SHALL return `/Users/alice/tempchrome`

#### Scenario: The legacy `chromiumPath` preference is not read
- **WHEN** the user's Raycast preference store still contains a value under the key `chromiumPath` from a previous version
- **AND** the user has not yet set `chromiumInstallDir`
- **THEN** `getPreferences()` SHALL ignore the `chromiumPath` value entirely
- **AND** `getPreferences().installDir` SHALL be the tilde-expanded default (`<home>/Applications`)
- **AND** SHALL NOT walk the legacy value to recover a directory

### Requirement: No-view command launches Chromium with a fresh temporary profile
The system SHALL expose a Raycast command named "Launch TempChrome" with `mode: "no-view"` that creates a new temporary profile directory, spawns Chromium with that profile, observes the spawned process for an early-crash grace window, triggers the opportunistic auto-cleanup sweep, and shows a HUD. The command SHALL render no Raycast UI beyond the HUD (with the exception of the failure toast produced by an early-crash detection, described below). The same behavior SHALL also be reachable as the "Launch Now" action inside the `TempChrome` List command.

During the grace window the command SHALL await the result of `launchChromium(...)`. Callers SHALL show an animated `Toast` / `HUD` state (e.g. `"Launching TempChrome…"`) before awaiting and transition to the success or failure state based on the returned promise. `launchChromium` SHALL resolve successfully if the spawned Chromium child is still alive when the grace window elapses, and SHALL reject if the child emits `exit` (with any code) or `error` during the window.

#### Scenario: Successful quick launch
- **WHEN** the user invokes "Launch TempChrome" (or triggers the "Launch Now" action inside the TempChrome List command)
- **THEN** the system SHALL read `binaryPath`, `appBundlePath`, and `tempBaseDir` from extension preferences
- **AND** verify that the file at `binaryPath` is accessible with `fs.constants.X_OK`
- **AND** ensure the directory at `tempBaseDir` exists with mode `0o700` (creating it if necessary)
- **AND** create a new directory at `<tempBaseDir>/<id>` where `<id>` is a 10-character string drawn from `a-z0-9`, with mode `0o700`
- **AND** clear macOS quarantine attributes on the `appBundlePath` via `execFile("xattr", ["-cr", appBundlePath])`, swallowing any error
- **AND** spawn Chromium via `child_process.spawn(binaryPath, args, { detached: true, stdio: "ignore", env })`
- **AND** observe the child for `exit` and `error` events for a grace window of `750` ms
- **AND** if the child is still alive at the end of the window, call `child.unref()` and resolve the launch promise
- **AND** the `args` passed to `spawn` SHALL be `["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=<profileDir>", "--enable-logging=stderr", "--log-file=<profileDir>/chrome_debug.log", ...extraArgs]`
- **AND** the `--log-file` value SHALL be computed at launch time by joining the freshly created `<profileDir>` with the filename `chrome_debug.log` using `node:path.join`
- **AND** the `env` passed to `spawn` SHALL be `{ ...process.env, GOOGLE_API_KEY: "AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k", GOOGLE_DEFAULT_CLIENT_ID: "811574891467.apps.googleusercontent.com", GOOGLE_DEFAULT_CLIENT_SECRET: "kdloedMFGdGla2P1zacGjAQh" }`
- **AND** invoke the opportunistic auto-cleanup sweep as a fire-and-forget async call (see separate requirement)
- **AND** show a HUD with text `"Launched"` (or the richer HUD produced by `launchWithValues`)

#### Scenario: Chromium binary missing
- **WHEN** the user invokes "Launch TempChrome"
- **AND** the file at `binaryPath` is not accessible (does not exist, is not a regular file, or lacks execute permission)
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
