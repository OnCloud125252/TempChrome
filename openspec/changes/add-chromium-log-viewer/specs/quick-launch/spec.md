## MODIFIED Requirements

### Requirement: No-view command launches Chromium with a fresh temporary profile
The system SHALL expose a Raycast command named "Launch TempChrome" with `mode: "no-view"` that creates a new temporary profile directory, spawns Chromium with that profile, triggers the opportunistic auto-cleanup sweep, and shows a HUD. The command SHALL render no Raycast UI beyond the HUD. The same behavior SHALL also be reachable as the "Launch Now" action inside the `TempChrome` List command.

#### Scenario: Successful quick launch
- **WHEN** the user invokes "Launch TempChrome" (or triggers the "Launch Now" action inside the TempChrome List command)
- **THEN** the system SHALL read `chromiumPath` and `tempBaseDir` from extension preferences
- **AND** verify that the file at `chromiumPath` is accessible with `fs.constants.X_OK`
- **AND** ensure the directory at `tempBaseDir` exists with mode `0o700` (creating it if necessary)
- **AND** create a new directory at `<tempBaseDir>/<id>` where `<id>` is a 10-character string drawn from `a-z0-9`, with mode `0o700`
- **AND** clear macOS quarantine attributes on the Chromium `.app` bundle via `execFile("xattr", ["-cr", <appBundlePath>])`, swallowing any error
- **AND** spawn Chromium via `child_process.spawn(chromiumPath, args, { detached: true, stdio: "ignore", env })`, then immediately call `child.unref()`
- **AND** the `args` passed to `spawn` SHALL be `["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=<profileDir>", "--enable-logging=stderr", "--log-file=<profileDir>/chrome_debug.log"]`
- **AND** the `--log-file` value SHALL be computed at launch time by joining the freshly created `<profileDir>` with the filename `chrome_debug.log` using `node:path.join`
- **AND** the `env` passed to `spawn` SHALL be `{ ...process.env, GOOGLE_API_KEY: "AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k", GOOGLE_DEFAULT_CLIENT_ID: "811574891467.apps.googleusercontent.com", GOOGLE_DEFAULT_CLIENT_SECRET: "kdloedMFGdGla2P1zacGjAQh" }`
- **AND** invoke the opportunistic auto-cleanup sweep as a fire-and-forget async call (see separate requirement)
- **AND** show a HUD with text `"Launched TempChrome"`

#### Scenario: Chromium binary missing
- **WHEN** the user invokes "Launch TempChrome"
- **AND** the file at `chromiumPath` is not accessible (does not exist, is not a regular file, or lacks execute permission)
- **THEN** the system SHALL call `showFailureToast` with title `"Chromium not found"` and message `"Run 'Install or Update Chromium' from the TempChrome command to install it."`
- **AND** SHALL NOT create any temp profile directory
- **AND** SHALL NOT spawn any process

#### Scenario: Log file lifetime is tied to the profile directory
- **WHEN** a successful quick launch has occurred
- **THEN** Chromium SHALL write diagnostic output to `<profileDir>/chrome_debug.log` (via `--log-file`) and also to stderr (via `--enable-logging=stderr`)
- **AND** the log file SHALL reside inside the profile directory, inheriting its `0o700` permissions
- **AND** no separate log directory (for example `~/Library/Logs/TempChrome/`) SHALL be created by the extension
