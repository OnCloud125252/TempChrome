# quick-launch Specification

## Purpose
TBD - created by archiving change raycast-extension. Update Purpose after archive.
## Requirements
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
- **AND** the `args` passed to `spawn` SHALL be `["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=<profileDir>"]`
- **AND** the `env` passed to `spawn` SHALL be `{ ...process.env, GOOGLE_API_KEY: "AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k", GOOGLE_DEFAULT_CLIENT_ID: "811574891467.apps.googleusercontent.com", GOOGLE_DEFAULT_CLIENT_SECRET: "kdloedMFGdGla2P1zacGjAQh" }`
- **AND** invoke the opportunistic auto-cleanup sweep as a fire-and-forget async call (see separate requirement)
- **AND** show a HUD with text `"Launched TempChrome"`

#### Scenario: Chromium binary missing
- **WHEN** the user invokes "Launch TempChrome"
- **AND** the file at `chromiumPath` is not accessible (does not exist, is not a regular file, or lacks execute permission)
- **THEN** the system SHALL call `showFailureToast` with title `"Chromium not found"` and message `"Run 'Install or Update Chromium' from the TempChrome command to install it."`
- **AND** SHALL NOT create any temp profile directory
- **AND** SHALL NOT spawn any process

### Requirement: Temporary profile uses collision-resistant random IDs
The system SHALL generate profile directory names using exactly 10 characters drawn from the charset `abcdefghijklmnopqrstuvwxyz0123456789`. The system SHALL attempt `mkdir` atomically and retry on `EEXIST`, failing after 100 consecutive attempts.

#### Scenario: Profile directory is created atomically
- **WHEN** the system creates a new temporary profile directory
- **THEN** it SHALL generate a random 10-character ID from the charset above
- **AND** attempt `fs.promises.mkdir(path, { mode: 0o700 })`
- **AND** catch errors with `code === "EEXIST"` and retry with a freshly generated ID
- **AND** propagate errors with any other code
- **AND** throw after 100 consecutive `EEXIST` failures with message `"Failed to create unique profile directory after 100 attempts"`

### Requirement: Chromium path is configurable via extension preferences
The system SHALL read the Chromium binary path from a Raycast extension-level preference named `chromiumPath` with default value `/Applications/Chromium.app/Contents/MacOS/Chromium`.

#### Scenario: Default Chromium path
- **WHEN** the user has not set `chromiumPath` in Raycast Preferences
- **THEN** the system SHALL use `/Applications/Chromium.app/Contents/MacOS/Chromium` for all Chromium spawn and existence-check operations

#### Scenario: Custom Chromium path
- **WHEN** the user has set `chromiumPath` to `/Applications/Thorium.app/Contents/MacOS/Thorium` in Raycast Preferences
- **THEN** the system SHALL use that path for all Chromium spawn and existence-check operations
- **AND** derive the `.app` bundle path for quarantine clearing by walking up from `Contents/MacOS/Thorium` to `Thorium.app`

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
The system SHALL, after successfully spawning Chromium, invoke an asynchronous sweep that trashes every profile in the auto-cleanup registry whose Chromium process is no longer running. The sweep SHALL be fire-and-forget — the command SHALL NOT `await` it, and any error from the sweep SHALL NOT surface to the user or affect the launch's HUD.

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

#### Scenario: Sweep errors are swallowed
- **WHEN** the sweep runs
- **AND** any operation fails (e.g., `ps` fails, `trash` fails, `LocalStorage` is unavailable, or JSON parse of the registry fails)
- **THEN** the system SHALL catch the error
- **AND** SHALL NOT show any toast, HUD, or failure to the user
- **AND** the HUD from the originating launch command SHALL still have been shown

#### Scenario: Sweep does not block launch
- **WHEN** the launch command triggers the sweep
- **THEN** the sweep SHALL be invoked as a non-awaited async call (fire-and-forget)
- **AND** the originating command SHALL call `showHUD` and return without waiting for the sweep to complete

