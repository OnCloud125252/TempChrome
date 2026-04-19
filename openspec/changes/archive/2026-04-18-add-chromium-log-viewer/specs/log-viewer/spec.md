## ADDED Requirements

### Requirement: LogViewer is a push-navigated List sub-view attached to each profile
The system SHALL expose a `LogViewer` component rendered as a Raycast `<List>` with a `<List.Item.Detail>` split pane. The component SHALL accept a single prop `profileDir: string` identifying the profile whose `<profileDir>/chrome_debug.log` file is to be tailed. The component SHALL be reachable only by push-navigation from a `profile-manager` list item (see that capability for the action wiring).

#### Scenario: Mount and initial render
- **WHEN** `LogViewer` is mounted with a valid `profileDir` prop
- **THEN** the system SHALL set `navigationTitle` to `"Chromium Log · <basename(profileDir)>"`
- **AND** set `searchBarPlaceholder` to a string containing the current line count and tailer state (for example `"1,247 lines · tailing"`, `"1,247 lines · ended"`, `"1,247 lines · session cleaned up"`)
- **AND** set `isShowingDetail` to `true` so the right-hand Detail pane is always visible
- **AND** start the tailer loop (see "Tailer polls the log file with a stat-based offset loop")
- **AND** start the process-presence loop (see "Process presence is checked on a 2-second cadence")

#### Scenario: Unmount
- **WHEN** `LogViewer` unmounts (user navigates back, Raycast closes, or the component is replaced)
- **THEN** the system SHALL clear both the tailer and process-presence intervals
- **AND** SHALL NOT persist the in-memory line buffer (logs remain on disk when the profile exists)

### Requirement: Tailer polls the log file with a stat-based offset loop
The system SHALL tail `<profileDir>/chrome_debug.log` by running a `setInterval` loop at 250 ms cadence. Each tick SHALL `fs.stat` the file, read the byte range `[offset, size]` when `size > offset`, split on `"\n"`, parse each complete line, and append parsed rows to component state. The system SHALL NOT use `fs.watch` (unreliable on macOS for log-file appends).

#### Scenario: Normal append
- **WHEN** a tick observes `stat.size > storedOffset`
- **THEN** the system SHALL open the file, read the byte range `[storedOffset, stat.size]` as a `Buffer`
- **AND** feed the buffer through `StringDecoder("utf8")` to produce a UTF-8 string while buffering incomplete multi-byte sequences across ticks
- **AND** split the decoded string on `"\n"`, treating the final fragment (no trailing newline) as a partial line to be prepended to the next tick's decode
- **AND** parse each complete line via the parser (see "Chromium log parser accepts structured and raw lines")
- **AND** append the parsed rows to the buffer, subject to cap and dedup
- **AND** set `storedOffset = stat.size`

#### Scenario: File truncation detected
- **WHEN** a tick observes `stat.size < storedOffset` OR `stat.ino !== storedIno`
- **THEN** the system SHALL reset `storedOffset = 0`
- **AND** clear the current in-memory line buffer
- **AND** re-read from offset 0 on the same tick
- **AND** show a transient `Toast.Style.Animated` → `Success` titled `"Log was truncated — re-reading from start"`

#### Scenario: Partial trailing line never terminates
- **WHEN** the decoder's internal partial-line buffer grows beyond 65536 bytes without seeing a newline
- **THEN** the system SHALL flush the buffered bytes as a single `type: "raw"` row annotated with a `⚠ truncated` marker
- **AND** reset the partial-line buffer to empty

### Requirement: Initial open of a large log file seeks to the last 5 MB
The system SHALL, on first tick after mount, measure `stat.size`. If `size > 5 * 1024 * 1024`, the system SHALL seek to `size - 5 * 1024 * 1024`, scan forward to the next `"\n"` boundary, and set `storedOffset` to the position immediately after that newline. If `size <= 5 * 1024 * 1024`, the system SHALL set `storedOffset = 0`.

#### Scenario: Small existing log
- **WHEN** the log file exists and `stat.size` is 2 MB at first tick
- **THEN** the system SHALL set `storedOffset = 0`
- **AND** read the whole file on this tick

#### Scenario: Large existing log
- **WHEN** the log file exists and `stat.size` is 50 MB at first tick
- **THEN** the system SHALL seek to byte `45 * 1024 * 1024`, advance to the next `"\n"`, and set `storedOffset` to the position after that newline
- **AND** read only the trailing slice
- **AND** surface a footer item or banner text noting that older lines exist on disk and suggesting "Reveal in Finder"

### Requirement: Chromium log parser accepts structured and raw lines
The system SHALL parse each complete line with the regex `^\[(\d+):(\d+):(\d{4})\/(\d{6})\.(\d+):([A-Z]+):([^:]+):(\d+)\] (.*)$`. Matched lines SHALL produce a `type: "structured"` row with fields `pid`, `tid`, `date` (MMDD), `time` (HHMMSS.micro), `level`, `sourceFile`, `sourceLine`, and `message`. Lines that do not match SHALL produce a `type: "raw"` row with the full line as `text` and severity `RAW`.

#### Scenario: Structured error line
- **WHEN** the parser encounters the line `[542:73528865:0417/063444.696006:ERROR:chrome/browser/ui/webui/ntp/new_tab_ui.cc:54] Requested load of chrome://newtab/ for incorrect profile type.`
- **THEN** the parser SHALL produce a row with `type: "structured"`, `pid: "542"`, `tid: "73528865"`, `date: "0417"`, `time: "063444.696006"`, `level: "ERROR"`, `sourceFile: "chrome/browser/ui/webui/ntp/new_tab_ui.cc"`, `sourceLine: "54"`, `message: "Requested load of chrome://newtab/ for incorrect profile type."`

#### Scenario: Interleaved / garbled line from concurrent stderr writes
- **WHEN** the parser encounters the line `2026-04-17 06:34:52.080 Chromium[542:73528865] error messaging the mach port for IMKCFR[542:73528979:0417/063512.032363:ERROR:google_apis/gcm/engine/registrat`
- **THEN** the parser SHALL produce a row with `type: "raw"`, severity `RAW`, and the unmodified source text
- **AND** SHALL NOT throw or skip the line

#### Scenario: Preamble / NSLog line
- **WHEN** the parser encounters the line `Trying to load the allocator multiple times. This is *not* supported.`
- **THEN** the parser SHALL produce a row with `type: "raw"`, severity `RAW`

### Requirement: Consecutive-duplicate dedup is on by default
The system SHALL, by default, collapse consecutive rows whose `message` field (for structured rows) or full `text` (for raw rows) are byte-identical into a single rendered item with an `×N` badge on the item's `accessories`, where N is the consecutive-duplicate count. The system SHALL preserve the **first** row's timestamp and source fields and SHALL record the time span `[first.time .. last.time]` for display in the detail pane. The user SHALL be able to toggle dedup off/on via an action with shortcut `⌘D`.

#### Scenario: Burst of identical messages
- **WHEN** the parser emits 20 consecutive rows whose `message` is exactly `SharedImageManager::ProduceOverlay: Trying to Produce a Overlay representation from a non-existent mailbox.`
- **AND** dedup is on (the default)
- **THEN** the List SHALL show exactly one `List.Item` for those 20 rows
- **AND** its `accessories` SHALL include a tag accessory showing `"×20"`
- **AND** its Detail pane SHALL show the time span from the first to the last entry (for example `063602.501096 → 063602.548409`)

#### Scenario: Dedup toggled off
- **WHEN** the user triggers the dedup toggle action (shortcut `⌘D`)
- **THEN** the system SHALL re-render the List with every row as a separate `List.Item`
- **AND** show a `Toast.Style.Success` titled `"Dedup off"`
- **AND** toggling again SHALL show `"Dedup on"`

### Requirement: Line buffer is capped at 2000 items
The system SHALL keep at most 2000 rows in the in-memory buffer. When appending would exceed the cap, the system SHALL drop the oldest rows first to make room.

#### Scenario: Cap enforcement
- **WHEN** the buffer contains 2000 rows and 5 new rows arrive on a tick
- **THEN** the system SHALL drop the oldest 5 rows
- **AND** the buffer SHALL contain exactly 2000 rows after the tick
- **AND** the searchBarPlaceholder line count SHALL display `"2,000 lines"` (no "/2000" suffix, to signal that older lines exist on disk)

### Requirement: Severity filter dropdown defaults to "All"
The system SHALL render a `List.Dropdown` in the `searchBarAccessory` slot with entries `{ value: "all", title: "All" }`, `{ value: "ERROR", title: "Errors" }`, `{ value: "WARNING", title: "Warnings" }`, `{ value: "INFO", title: "Info" }`, `{ value: "RAW", title: "Raw" }`. The default value SHALL be `"all"`. Selection SHALL filter the rendered rows without mutating the buffer.

#### Scenario: Default renders everything
- **WHEN** the LogViewer is first mounted
- **THEN** the severity dropdown SHALL show `"All"` selected
- **AND** every row in the buffer (regardless of severity) SHALL be eligible for rendering

#### Scenario: Filter to errors only
- **WHEN** the user selects `"Errors"` from the dropdown
- **THEN** the system SHALL render only rows whose `level === "ERROR"`
- **AND** rows with other severities (including `"RAW"`) SHALL be hidden from the List but remain in the buffer

### Requirement: Auto-follow tail selection, pause on manual scroll, resume on keybind
The system SHALL, by default, set `selectedItemId` to the id of the newest row in the current rendered list whenever a tick appends new rows. If the user changes `selectedItemId` (via keyboard navigation) to any row other than the newest at append time, the system SHALL stop auto-following until the user triggers the "Jump to Tail" action (shortcut `⌘⇧G`). Triggering that action SHALL set `selectedItemId` back to the newest row and re-enable auto-follow.

#### Scenario: New line appended while auto-follow is on
- **WHEN** auto-follow is on and a tick appends rows
- **THEN** the system SHALL set `selectedItemId` to the newest row's id

#### Scenario: User presses arrow-up while tailing
- **WHEN** auto-follow is on and the user navigates to a non-newest row
- **THEN** the system SHALL set `autoFollow = false`
- **AND** subsequent ticks SHALL NOT alter `selectedItemId`
- **AND** the `searchBarPlaceholder` SHALL include the suffix `" · paused"`

#### Scenario: Jump back to tail
- **WHEN** the user triggers the "Jump to Tail" action (shortcut `⌘⇧G`)
- **THEN** the system SHALL set `selectedItemId` to the newest row's id
- **AND** set `autoFollow = true`
- **AND** remove the `" · paused"` suffix from `searchBarPlaceholder`

### Requirement: Tailer state machine exposes six lifecycle states
The system SHALL maintain a `tailerState` enum with exactly these values: `WAITING`, `LIVE`, `ENDED_PERSISTENT`, `SWEPT`, `ORPHANED`, `LOG_GONE`. Transitions SHALL be driven by `fs.stat(logPath)` outcomes combined with `isProfileInUse(profileDir)` (from `src/chromium/processes.ts`).

#### Scenario: WAITING — file does not yet exist but Chromium is running
- **WHEN** on mount, `fs.stat(logPath)` throws `ENOENT` AND `isProfileInUse(profileDir)` returns `true`
- **THEN** the system SHALL set `tailerState = WAITING`
- **AND** render a list-level EmptyView with `title: "Waiting for first log line…"` and `description: "Chromium is running but has not written anything yet."`
- **AND** keep polling; the state SHALL transition to `LIVE` on the first tick where `fs.stat(logPath)` succeeds

#### Scenario: LIVE — file exists and Chromium is running
- **WHEN** `fs.stat(logPath)` succeeds AND `isProfileInUse(profileDir)` returns `true`
- **THEN** the system SHALL set `tailerState = LIVE`
- **AND** the `searchBarPlaceholder` SHALL include the substring `"tailing"`

#### Scenario: ENDED_PERSISTENT — Chromium exited, file remains
- **WHEN** `isProfileInUse(profileDir)` returns `false` AND `fs.stat(logPath)` succeeds AND `fs.stat(profileDir)` succeeds
- **THEN** the system SHALL set `tailerState = ENDED_PERSISTENT`
- **AND** do one final tail read to capture any buffered final lines
- **AND** show a banner item at the top of the list with title `"Session ended"` and subtitle `"Log file preserved at <logPath>"`
- **AND** the `searchBarPlaceholder` SHALL include the substring `"ended"`

#### Scenario: SWEPT — profile directory no longer exists and Chromium is gone
- **WHEN** `fs.stat(profileDir)` throws `ENOENT` AND `isProfileInUse(profileDir)` returns `false`
- **THEN** the system SHALL set `tailerState = SWEPT`
- **AND** freeze the buffer (stop reading, but keep currently-rendered rows visible)
- **AND** show a banner item with title `"Session ended and profile was auto-cleaned"` and subtitle `"Showing buffered lines from memory — navigate away to lose them."`
- **AND** the `searchBarPlaceholder` SHALL include the substring `"session cleaned up"`

#### Scenario: ORPHANED — profile dir gone but Chromium still running
- **WHEN** `fs.stat(profileDir)` throws `ENOENT` AND `isProfileInUse(profileDir)` returns `true`
- **THEN** the system SHALL set `tailerState = ORPHANED`
- **AND** show a banner item with title `"Profile directory was removed externally"` and subtitle `"Chromium is still running but its log file is unreachable. Data written after this point is lost."`
- **AND** SHALL NOT attempt further reads (nothing to read)

#### Scenario: LOG_GONE — log file removed but profile and Chromium still there
- **WHEN** `fs.stat(logPath)` throws `ENOENT` AND `fs.stat(profileDir)` succeeds AND `isProfileInUse(profileDir)` returns `true`
- **THEN** the system SHALL set `tailerState = LOG_GONE`
- **AND** show a banner item with title `"Log file was removed externally"` and subtitle `"Chromium is still running; restart it to resume logging."`

### Requirement: Process presence is checked on a 2-second cadence
The system SHALL run a second `setInterval` at 2000 ms cadence that invokes `isProfileInUse(profileDir)` and uses the result to drive state transitions. The system SHALL NOT run `isProfileInUse` inside the 250 ms tailer loop (too expensive).

#### Scenario: Chromium exits while LIVE
- **WHEN** the 2 s interval fires and `isProfileInUse(profileDir)` returns `false` for the first time
- **AND** `fs.stat(logPath)` succeeds AND `fs.stat(profileDir)` succeeds
- **THEN** the system SHALL transition from `LIVE` to `ENDED_PERSISTENT`
- **AND** the next tailer tick SHALL run one final read to catch buffered lines before no more appends can occur

### Requirement: Condemned-profile warning when viewing an auto-cleanup-marked exited session
The system SHALL, when `tailerState === ENDED_PERSISTENT`, read the `markForAutoCleanup` registry (via the existing helper in `src/profiles/autoCleanup.ts`) and check whether `profileDir` is present. If present, the system SHALL render a prominent warning banner item with title `"⚠ This profile is marked for auto-cleanup"` and subtitle `"The next TempChrome launch will remove this log. Use ⌘S to save the buffer first."`

#### Scenario: Viewing an auto-cleanup-marked exited session
- **WHEN** the tailer has transitioned to `ENDED_PERSISTENT`
- **AND** `autoCleanupRegistry.has(profileDir) === true`
- **THEN** the banner item described above SHALL appear at the top of the List
- **AND** the `accessories` of that banner item SHALL include `{ icon: Icon.ExclamationMark, tint: Color.Yellow }`

#### Scenario: Viewing a non-auto-cleanup exited session
- **WHEN** the tailer has transitioned to `ENDED_PERSISTENT`
- **AND** `autoCleanupRegistry.has(profileDir) === false`
- **THEN** the system SHALL render the standard "Session ended" banner only (no condemned-profile warning)

### Requirement: Per-item actions wire toast feedback and shortcuts
Every `<Action>` in the `LogViewer` action panel SHALL declare a `shortcut` prop except the single ⏎-primary action per `<ActionPanel>`. User-triggered actions SHALL surface `Toast.Style.Success` or `Toast.Style.Failure` feedback via `showToast` / `showFailureToast` from `@raycast/utils`, per the project UX policy.

#### Scenario: Copy Line (primary)
- **WHEN** the user presses `⏎` on a row
- **THEN** the system SHALL copy the raw source line (for `type: "raw"` rows) or the reconstructed structured line (for `type: "structured"` rows) to the clipboard via `Clipboard.copy`
- **AND** show a `Toast.Style.Success` titled `"Copied line"`

#### Scenario: Copy with Context
- **WHEN** the user triggers "Copy with Context" (shortcut `⌘⇧C`) on a row
- **THEN** the system SHALL copy a multi-line string containing the selected row's full text surrounded by the 5 preceding and 5 following rows (or fewer at buffer boundaries)
- **AND** show a `Toast.Style.Success` titled `"Copied line with ±5 context"`

#### Scenario: Reveal in Finder
- **WHEN** the user triggers "Reveal in Finder" (shortcut `⌘⇧O`)
- **AND** `tailerState` is `LIVE`, `WAITING`, `ENDED_PERSISTENT`, or `LOG_GONE`
- **THEN** the system SHALL call `showInFinder(logPath)`
- **AND** show a `Toast.Style.Success` titled `"Revealed in Finder"`

#### Scenario: Reveal in Finder in SWEPT/ORPHANED state
- **WHEN** `tailerState` is `SWEPT` or `ORPHANED`
- **THEN** the "Reveal in Finder" action SHALL NOT appear in the action panel

### Requirement: Save Buffer writes in-memory lines to Downloads
The system SHALL expose a "Save Buffer to Downloads…" action (shortcut `⌘S`) that writes the currently buffered rows to `~/Downloads/tempchrome-<profileId>-<YYYYMMDD-HHmmss>.log` as newline-joined raw text (raw rows use their source text; structured rows use their reconstructed `[pid:tid:date/time.µ:LEVEL:file:line] message` form).

#### Scenario: Save succeeds
- **WHEN** the user triggers "Save Buffer to Downloads…"
- **AND** the buffer contains at least one row
- **THEN** the system SHALL compute the target path `~/Downloads/tempchrome-<basename(profileDir)>-<timestamp>.log`
- **AND** write the newline-joined buffer text to that path with mode `0o644`
- **AND** show a `Toast.Style.Success` with title `"Saved <N> lines"` and a primary `Action.ShowInFinder` pointing to the written file

#### Scenario: Save fails (disk full, permission denied, etc.)
- **WHEN** writing the buffer file throws any error
- **THEN** the system SHALL call `showFailureToast(error, { title: "Failed to save buffer" })`

#### Scenario: Save with empty buffer
- **WHEN** the buffer is empty
- **THEN** the system SHALL show a `Toast.Style.Failure` with title `"Nothing to save"` and SHALL NOT write a file

### Requirement: Tailer failures never crash the LogViewer component
The system SHALL wrap every `fs.stat`, `fs.open`, `fs.read`, and process-presence call inside the tailer loops in a `try/catch`. Any error SHALL be converted into a state transition (per the state machine) or logged via `console.error`, and SHALL NOT propagate out of the interval callback.

#### Scenario: Unexpected fs error on a tick
- **WHEN** a tailer tick throws an error other than `ENOENT` (for example `EACCES`, `EIO`)
- **THEN** the system SHALL call `console.error("tailer tick failed", error)`
- **AND** schedule a retry on the next 250 ms interval
- **AND** NOT unmount or throw

#### Scenario: Parser throws on pathological input
- **WHEN** the parser throws on a malformed line (defensive case — in practice the regex-based parser does not throw)
- **THEN** the system SHALL emit a `type: "raw"` row with the original bytes and continue processing subsequent lines
