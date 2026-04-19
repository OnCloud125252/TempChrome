# profile-manager Specification

## Purpose
TBD - created by archiving change raycast-extension. Update Purpose after archive.
## Requirements
### Requirement: Manage Profiles is a push-navigated List sub-view
The system SHALL expose "Manage Temp Profiles…" as a `List.Item` inside the `TempChrome` List command. Its primary action SHALL push a component rendering a Raycast `<List>` that displays every subdirectory of the configured `tempBaseDir`.

#### Scenario: Navigation to the profile list
- **WHEN** the user selects "Manage Temp Profiles…" in the TempChrome List and triggers its primary action
- **THEN** the system SHALL push a component rendering a `<List>` onto the navigation stack
- **AND** the list SHALL be reachable via back-navigation (ESC) back to the TempChrome List

### Requirement: List displays every subdirectory of the temp base directory
The system SHALL, on mount and on every refresh, enumerate subdirectories of `tempBaseDir` and render one `List.Item` per subdirectory. Items SHALL be sorted by `fs.stat.birthtime` descending (newest first). Directory sizes for the `subtitle` accessory SHALL be computed in parallel with a concurrency cap of `4` concurrent `computeDirectorySize` walks, so that a user with many profiles does not wait for sequential disk walks. Stat and walk failures on individual profiles SHALL flow through `reportError(..., { silent: true })` and SHALL cause only the failing profile to be skipped — the remaining profiles SHALL still render.

#### Scenario: Profiles exist
- **WHEN** `tempBaseDir` contains at least one subdirectory
- **THEN** the system SHALL render a `<List>` with one `<List.Item>` per subdirectory
- **AND** each item's `title` SHALL be the directory's basename (the 10-character ID)
- **AND** each item's `subtitle` SHALL be the directory's total recursive size formatted via a humanized size helper (examples: `"892 KB"`, `"12.4 MB"`, `"1.2 GB"`)
- **AND** each item's `accessories` SHALL include `{ date: <birthtime Date> }` showing the directory's creation time
- **AND** items SHALL be sorted by `birthtime` descending

#### Scenario: No profiles exist
- **WHEN** `tempBaseDir` is empty or does not exist
- **THEN** the system SHALL render `<List.EmptyView>` with `title: "No temporary profiles found"` and `description: "Launch TempChrome to create one."`
- **AND** the EmptyView SHALL include a single `Action` titled `"Launch TempChrome"` that performs a quick-launch and triggers a list refresh

#### Scenario: Sizes are computed in parallel
- **WHEN** the list enumerates `N >= 8` profile directories
- **THEN** at most `4` `computeDirectorySize` walks SHALL be in flight at any moment
- **AND** the total wall-clock time for size computation SHALL be bounded by approximately `ceil(N / 4) * median(single-profile walk time)` (not `N * median`)

#### Scenario: A single profile's stat failure does not abort the list
- **WHEN** listing encounters an error other than `ENOENT` while stat'ing one profile directory
- **THEN** the failing profile SHALL be omitted from the rendered list
- **AND** `reportError("Could not read profile directory", error, { silent: true })` SHALL be invoked
- **AND** the remaining profiles SHALL still render

### Requirement: In-use detection runs once per refresh via `ps`
The system SHALL detect which profiles are currently in use by running `execFile("ps", ["-Ao", "args="])` exactly once per list refresh (not once per item) and then checking each profile path against the `ps` output.

#### Scenario: Single ps invocation per refresh
- **WHEN** the list refreshes (mount, manual refresh, or post-action refresh)
- **THEN** the system SHALL invoke `execFile("ps", ["-Ao", "args="])` exactly once
- **AND** SHALL reuse the parsed output across all profile items in the current render

#### Scenario: Profile in use
- **WHEN** any line of the `ps` output contains the substring `"--user-data-dir=" + profilePath`
- **THEN** the corresponding `List.Item`'s `accessories` SHALL include a tag accessory `{ tag: { value: "In use", color: Color.Green }, icon: Icon.CircleFilled }`

#### Scenario: Profile idle
- **WHEN** no line of the `ps` output contains the substring `"--user-data-dir=" + profilePath`
- **THEN** the corresponding `List.Item`'s `accessories` SHALL include a tag accessory `{ tag: { value: "Idle", color: Color.SecondaryText } }`

### Requirement: Auto-cleanup badge reflects the LocalStorage registry
The system SHALL read the auto-cleanup registry from `LocalStorage` under key `"tempchrome.auto-cleanup-registry"` once per refresh and display a badge on every `List.Item` whose path is a key in the registry.

#### Scenario: Profile in auto-cleanup registry
- **WHEN** the parsed registry contains the profile path as a key
- **THEN** the `List.Item`'s `accessories` SHALL additionally include `{ tag: { value: "Auto-cleanup", color: Color.Blue } }`

#### Scenario: Profile not in registry
- **WHEN** the parsed registry does not contain the profile path as a key
- **THEN** the `List.Item`'s `accessories` SHALL NOT include the "Auto-cleanup" tag

### Requirement: "Show in Finder" action
The system SHALL provide a `Action.ShowInFinder` on each `List.Item`'s `ActionPanel`, targeting the profile's absolute path.

#### Scenario: Show in Finder
- **WHEN** the user triggers the "Show in Finder" action on a profile
- **THEN** Finder SHALL reveal the profile directory (via Raycast's built-in `Action.ShowInFinder` targeting the profile's absolute path)

### Requirement: "Copy Path" action
The system SHALL provide an `Action.CopyToClipboard` on each `List.Item`'s `ActionPanel`, labeled `"Copy Path"`, copying the profile's absolute path.

#### Scenario: Copy path
- **WHEN** the user triggers the "Copy Path" action on a profile
- **THEN** the absolute profile path SHALL be copied to the clipboard via Raycast's `Action.CopyToClipboard`
- **AND** a HUD with text `"Path copied"` SHALL be shown

### Requirement: "Launch with This Profile" action
The system SHALL provide an action on each `List.Item` that spawns Chromium using the selected profile directory (rather than creating a new one). The spawn SHALL follow the same pattern as quick-launch except that `--user-data-dir` points to the selected profile.

#### Scenario: Relaunch with an existing profile
- **WHEN** the user triggers the "Launch with This Profile" action on a profile at path `P`
- **THEN** the system SHALL verify `chromiumPath` is accessible; on miss, show a failure toast and abort
- **AND** call `execFile("xattr", ["-cr", <appBundlePath>])`, swallowing errors
- **AND** call `child_process.spawn(chromiumPath, ["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=" + P], { detached: true, stdio: "ignore", env })` where `env` includes the three `GOOGLE_*` variables
- **AND** immediately call `child.unref()`
- **AND** show a HUD with text `"Launched with profile " + <basename(P)>`

### Requirement: "Delete Profile" action with confirmation
The system SHALL provide an action on each `List.Item` that deletes the profile via the `trash` CLI after a `confirmAlert` confirmation. The action SHALL remove the profile from the auto-cleanup registry (if present) and refresh the list.

#### Scenario: Delete idle profile
- **WHEN** the user triggers the "Delete Profile" action on a profile at path `P` that is **not** in use
- **THEN** the system SHALL call `confirmAlert({ title: "Delete profile?", message: "<basename(P)> (<size>) will be moved to Trash.", primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive } })`
- **AND** if the user confirms: call the `trashPath(P)` helper (which tries `trash` then falls back to `fs.rm`)
- **AND** if `P` is a key in the auto-cleanup registry, remove it and persist the registry
- **AND** revalidate the list

#### Scenario: Delete in-use profile requires stronger confirmation
- **WHEN** the user triggers the "Delete Profile" action on a profile that **is** in use
- **THEN** the system SHALL call `confirmAlert` with `title: "Delete profile in use?"`, `message: "<basename(P)> (<size>) is currently in use by Chromium. Deleting it may corrupt the running session. Continue?"`, and `primaryAction: { title: "Delete Anyway", style: Alert.ActionStyle.Destructive }`
- **AND** if the user confirms, proceed with deletion as in the idle case

#### Scenario: User cancels deletion
- **WHEN** the user triggers the "Delete Profile" action and chooses the non-primary option in the confirmAlert
- **THEN** the system SHALL NOT delete the profile
- **AND** SHALL NOT modify the auto-cleanup registry
- **AND** SHALL NOT refresh the list

### Requirement: "Delete All Idle Profiles" action with confirmation
The system SHALL provide an action on the list's `ActionPanel` that deletes every idle profile in parallel after a `confirmAlert` confirmation. In-use profiles SHALL be skipped. The action's keyboard shortcut SHALL be `Cmd+Shift+Backspace`.

#### Scenario: Delete all idle profiles
- **WHEN** the user triggers "Delete All Idle Profiles"
- **AND** `N` profiles are idle and `M` profiles are in use (with combined idle size `S`)
- **THEN** the system SHALL call `confirmAlert` with `title: "Delete " + N + " idle profile(s)?"`, `message: "Total " + <humanizedSize(S)> + " will be moved to Trash. " + M + " in-use profile(s) will be skipped."`, and `primaryAction: { title: "Delete " + N, style: Alert.ActionStyle.Destructive }`
- **AND** if confirmed, call `Promise.all(idleProfiles.map(p => trashPath(p)))`
- **AND** for each successfully deleted path that is a key in the registry, remove it
- **AND** persist the updated registry
- **AND** show a toast with `title: "Deleted " + N + " profile(s)"` and `message: M + " skipped (in use)"` (omit the message if `M === 0`)
- **AND** revalidate the list

#### Scenario: No idle profiles to delete
- **WHEN** the user triggers "Delete All Idle Profiles"
- **AND** all profiles are currently in use, or no profiles exist
- **THEN** the system SHALL show a toast with `title: "Nothing to delete"` and `message: "All profiles are in use."` (or `"No profiles found."` if the list is empty)
- **AND** SHALL NOT show a confirmAlert
- **AND** SHALL NOT modify anything

### Requirement: "Clean Up Stale Profiles" action
The system SHALL provide an action on the list's `ActionPanel` that trashes every profile present in the auto-cleanup registry whose Chromium process is not running (the immediate/manual variant of the opportunistic sweep).

#### Scenario: Clean up stale profiles
- **WHEN** the user triggers "Clean Up Stale Profiles"
- **THEN** the system SHALL invoke the same `sweepStaleProfiles()` function used by the opportunistic sweep in `quick-launch`
- **AND** `await` its completion (unlike the fire-and-forget invocation in launch)
- **AND** show a toast with `title: "Cleaned up " + <count> + " stale profile(s)"` where `<count>` is the number returned by the sweep
- **AND** revalidate the list

#### Scenario: No stale profiles to clean up
- **WHEN** the user triggers "Clean Up Stale Profiles"
- **AND** the sweep deletes zero profiles (either because the registry is empty or all registered profiles are still in use)
- **THEN** the system SHALL show a toast with `title: "Nothing to clean up"` and `message: "No stale auto-cleanup profiles found."`
- **AND** revalidate the list

## ADDED Requirements

### Requirement: Each profile list item exposes a "View Log" action
The system SHALL attach a "View Log" `Action.Push` to the `ActionPanel` of every `List.Item` rendered by the Manage Temp Profiles list. The action SHALL push the `LogViewer` component (from the `log-viewer` capability) with `profileDir` set to the absolute path of the profile directory for that row. The action SHALL bind shortcut `{ modifiers: ["cmd"], key: "l" }`.

#### Scenario: Action is present on every row
- **WHEN** the Manage Temp Profiles list renders any `List.Item` for a profile subdirectory
- **THEN** the item's `ActionPanel` SHALL include an `Action.Push` titled `"View Log"` with `icon: Icon.Document` (or the closest equivalent)
- **AND** the action SHALL declare `shortcut={{ modifiers: ["cmd"], key: "l" }}`
- **AND** its `target` prop SHALL be `<LogViewer profileDir={profile.path} />`

#### Scenario: Action is present regardless of whether the log file exists
- **WHEN** the profile directory does not contain a `chrome_debug.log` file (for example, for profiles created before this change shipped)
- **THEN** the "View Log" action SHALL still appear in the ActionPanel
- **AND** selecting it SHALL push the `LogViewer`, which SHALL surface the "No log file found" state per the `log-viewer` capability

### Requirement: "View Log" shortcut is advertised via accessories
The system SHALL add a tag accessory to each profile `List.Item`'s `accessories` array containing `{ tag: "⌘L" }` (in addition to any existing accessories such as in-use status and date). This advertises the shortcut without requiring the user to open the ⌘K action panel.

#### Scenario: Accessory is present
- **WHEN** the Manage Temp Profiles list renders a `List.Item`
- **THEN** the item's `accessories` SHALL include an accessory object `{ tag: "⌘L" }`
- **AND** this accessory SHALL appear in addition to (not replacing) the existing "In use" tag accessory when applicable and the date accessory

