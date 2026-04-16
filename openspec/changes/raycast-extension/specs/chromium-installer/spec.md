## ADDED Requirements

### Requirement: Install action delegates to the CLI via Terminal.app
The system SHALL expose "Install or Update Chromium…" as a `List.Item` inside the `TempChrome` List command. Its primary action SHALL open Terminal.app and run `tempchrome --install` there, then show a HUD and exit. The Raycast extension SHALL NOT download, extract, install, or modify any file related to Chromium snapshot installation itself — all such work happens inside the CLI inside Terminal.

#### Scenario: Install action opens Terminal and runs the CLI
- **WHEN** the user triggers the primary action on "Install or Update Chromium…" in the TempChrome List
- **THEN** the system SHALL call `execFile("osascript", ["-e", "tell application \"Terminal\" to activate", "-e", "tell application \"Terminal\" to do script \"tempchrome --install\""])`
- **AND** after the `execFile` promise resolves, call `showHUD("Opening Terminal to install Chromium…")`
- **AND** the Raycast command SHALL return immediately after the HUD is shown (no awaiting the install itself)

#### Scenario: osascript fails
- **WHEN** the `execFile("osascript", ...)` call rejects (for example, because Terminal.app is unavailable, AppleScript is disabled, or an automation permission prompt is denied)
- **THEN** the system SHALL call `showFailureToast(error, { title: "Could not open Terminal" })` where `error` is the rejection value
- **AND** the system SHALL NOT attempt any fallback install path
- **AND** the system SHALL NOT show the success HUD

### Requirement: Install action performs no pre-validation of the CLI
The system SHALL NOT check for the presence of the `tempchrome` CLI on PATH, inside the extension, before invoking `osascript`. If the CLI is missing, the user's shell inside Terminal SHALL surface the `command not found` error.

#### Scenario: CLI missing from PATH
- **WHEN** the user has not installed the `tempchrome` CLI on their shell PATH
- **AND** the user triggers "Install or Update Chromium…"
- **THEN** the system SHALL still invoke `osascript` as specified in the previous requirement
- **AND** Terminal.app SHALL display `zsh: command not found: tempchrome` (or the equivalent message for the user's shell)
- **AND** the Raycast extension SHALL NOT show any additional error toast or HUD beyond the standard success HUD (the Terminal output is the error message)

#### Scenario: CLI present on PATH
- **WHEN** the user has installed the `tempchrome` CLI on their shell PATH
- **AND** the user triggers "Install or Update Chromium…"
- **THEN** Terminal.app SHALL display the CLI's install progress output (curl progress bar, extraction message, completion message)
- **AND** the Raycast extension SHALL show the standard success HUD (`"Opening Terminal to install Chromium…"`) regardless of the install's eventual success or failure inside Terminal

### Requirement: Install action executes no Chromium-related I/O inside the extension
The Raycast extension's install action SHALL perform no `fetch`, no `unzip`, no `xattr`, no `mv`, and no `rm` related to Chromium snapshot installation. The only subprocess the action invokes is `osascript` (for Terminal automation).

#### Scenario: Extension process does not modify `/Applications/Chromium.app`
- **WHEN** the user triggers the install action
- **THEN** the Raycast extension's process SHALL NOT open, modify, delete, or move `/Applications/Chromium.app` or anything under it
- **AND** SHALL NOT create or modify any file under `/tmp/`
- **AND** SHALL NOT make any outbound HTTP request

#### Scenario: Only osascript is invoked
- **WHEN** the install action runs
- **THEN** the only `child_process` call the extension makes during the action SHALL be the single `execFile("osascript", [...])` invocation
