## Why

Chromium writes useful diagnostic output (errors, warnings, device events, crash precursors) to stderr and to `chrome_debug.log`, but the Raycast launcher spawns it with `stdio: "ignore"` and doesn't enable logging, so users debugging a site, a Chromium bug, or a TempChrome launch regression currently have **no way to see any of it** from inside Raycast. Running from the CLI helps only marginally because Chromium is silent by default unless `--enable-logging` is passed. A log viewer closes the visibility gap and turns the extension into a usable debugging surface, not just a launcher.

## What Changes

- Always pass `--enable-logging=stderr --log-file=<profileDir>/chrome_debug.log` when launching Chromium. The log file lives **inside the temp profile directory**, so its lifetime is tied to the profile's lifetime (cleaned up automatically with `--auto-cleanup`).
- Apply the same two flags in `cli/tempchrome.sh` so CLI users get both live stderr and a file on disk.
- Add a new Raycast view `LogViewer` that tails `<profileDir>/chrome_debug.log` using a 250 ms stat-based poll loop, parses each line into structured fields `[PID:TID:MMDD/HHMMSS.micro:LEVEL:source_file:line] message`, collapses consecutive duplicate messages into one row with an `×N` badge, and renders the result as a Raycast `<List>` with a `<List.Item.Detail>` split pane showing full raw line plus structured fields.
- Wire a **"View Log"** action (shortcut `⌘L`) into every row of the Manage Temp Profiles list. The action pushes `LogViewer` for that profile.
- Support the six viewer lifecycle states (LIVE, WAITING, ENDED_PERSISTENT, SWEPT, ORPHANED, LOG_GONE) driven by `fs.stat` + the existing `isProfileInUse()` check. Non-LIVE states show an informational banner; SWEPT/ORPHANED additionally disable disk-touching actions (Reveal in Finder, Open in Terminal).
- Add a **"Save Buffer to Downloads…"** action (shortcut `⌘S`) so users can preserve the in-memory buffer before an auto-cleanup sweep removes the profile.
- When the viewer is mounted on a profile that is present in the `markForAutoCleanup` registry **and** Chromium has already exited, show a soft **"condemned profile"** warning banner telling the user the next TempChrome launch will remove this log.
- Cap the in-memory line buffer at 2000 lines (drop oldest on overflow) and, when opening an existing log file larger than 5 MB, seek to `size - 5 MB` aligned to the next `\n` to avoid reading the whole file.
- Dedup-consecutive defaults to **on** (⌘D toggles). Severity-filter dropdown defaults to **All**. Auto-follow pauses when the user changes the selected item and resumes on ⌘⇧G.

## Capabilities

### New Capabilities

- `log-viewer`: Live-tailing Chromium log viewer inside Raycast, including parser, tailer, state machine, structured-vs-raw rendering, dedup, severity filter, auto-follow, save-buffer action, and the "condemned profile" warning banner.

### Modified Capabilities

- `quick-launch`: The spawn args SHALL additionally include `--enable-logging=stderr` and `--log-file=<profileDir>/chrome_debug.log`, computed at launch time from the freshly created profile directory.
- `profile-manager`: Each profile `List.Item` SHALL expose a "View Log" action (shortcut `⌘L`) that pushes the `LogViewer` component for that profile's directory. The action SHALL be visible regardless of whether a log file currently exists (the viewer itself surfaces the "no log file" state).

## Impact

- **Raycast source** — new directory `raycast/src/logs/` with `LogViewer.tsx`, `parser.ts`, `tailer.ts`, `dedupe.ts`, `severity.ts`; modifications to `raycast/src/chromium/launcher.ts` (append logging flags inside `launchChromium`) and `raycast/src/profiles/ProfileList.tsx` (add the View Log action).
- **CLI script** — `cli/tempchrome.sh` gains the same two flags in its Chromium invocation. No new options; the flags are always on.
- **No new dependencies** — parser is regex-based, tailer uses `node:fs` + `node:string_decoder`, no npm additions.
- **No preferences changes** — logging is always on; there is no toggle in extension preferences or in the Launch with Options form.
- **No breaking changes** — older profiles (created before this change) simply won't have a `chrome_debug.log`; the viewer shows an informational "No log file found for this profile" state for them.
- **macOS-only caveat** — in the ORPHANED state (log file removed while Chromium is still writing to its open `fd`) we cannot recover further bytes because macOS has no `/proc/<pid>/fd/N`. Documented in design.md; surfaced in the viewer via banner text.
- **Security** — log files are written inside `<tempBaseDir>/<id>/` which inherits mode `0o700` from the profile directory, so they are not world-readable.
