## 1. Launch-side: enable Chromium logging into the profile directory

- [x] 1.1 In `raycast/src/chromium/launcher.ts`, modify `launchChromium(chromiumPath, profileDir, extraArgs)` so that the `args` array appends `"--enable-logging=stderr"` and `"--log-file=<profileDir>/chrome_debug.log"` (compute the log path via `node:path.join(profileDir, "chrome_debug.log")`).
- [x] 1.2 Verify that `BASE_CHROMIUM_ARGS` in `raycast/src/chromium/constants.ts` is unchanged (the new flags are computed at launch time, not in the static constant), and leave a short single-line inline note only if genuinely non-obvious (default to no comment).
- [x] 1.3 In `cli/tempchrome.sh`, add `--enable-logging=stderr` and `--log-file="$PROFILE_DIR/chrome_debug.log"` to the Chromium invocation at the bottom of the script (after `--user-data-dir`).
- [x] 1.4 Run `shellcheck cli/tempchrome.sh` and fix any findings introduced by the change.
- [ ] 1.5 Manually launch Chromium once via Raycast `Launch TempChrome` and verify `<profileDir>/chrome_debug.log` is created and grows as the browser runs.
- [ ] 1.6 Manually launch Chromium once via `tempchrome` CLI and verify both stderr output is visible in the terminal *and* the same log file is written inside the profile dir.

## 2. Log parser (pure, no I/O)

- [x] 2.1 Create `raycast/src/logs/parser.ts` exporting `parseChromiumLog(line: string): StructuredLine | RawLine` with the regex `^\[(\d+):(\d+):(\d{4})\/(\d{6})\.(\d+):([A-Z]+):([^:]+):(\d+)\] (.*)$`.
- [x] 2.2 Export the `StructuredLine` and `RawLine` TypeScript types with the fields enumerated in `specs/log-viewer/spec.md` (pid, tid, date, time, level, sourceFile, sourceLine, message for structured; text and severity `"RAW"` for raw).
- [x] 2.3 Write unit-level fixtures in the same file (or a colocated `parser.test.ts` only if the repo has a test harness already — check `raycast/package.json` scripts; if no test runner, skip and rely on manual validation) covering at minimum: a standard ERROR line, an interleaved/garbled line, an NSLog-formatted Apple line, and the preamble `Trying to load the allocator multiple times.`.
- [x] 2.4 Export a `reconstructStructuredLine(line: StructuredLine): string` helper that rebuilds the canonical `[pid:tid:date/time.µ:LEVEL:file:line] message` string; used by Copy Line and Save Buffer.

## 3. Tailer (offset-based polling)

- [x] 3.1 Create `raycast/src/logs/tailer.ts` exporting a `createTailer({ logPath, onLines, onStateChange })` function that returns `{ start, stop }` handles.
- [x] 3.2 Implement the stat-based 250 ms polling loop: on each tick `fs.stat(logPath)` → read `[storedOffset, size]` → feed through `node:string_decoder.StringDecoder("utf8")` → split on `"\n"` → parse → `onLines(rows)`.
- [x] 3.3 Buffer any trailing partial line (no terminating newline) across ticks; flush as a `raw` row with a `⚠ truncated` marker if the partial-line buffer exceeds 64 KB.
- [x] 3.4 Detect truncation: `newSize < storedOffset` OR `stat.ino !== storedIno` → reset `storedOffset = 0`, clear internal partial-line buffer, re-read from 0, emit `onStateChange({ truncated: true })`.
- [x] 3.5 Implement first-open seek-skip: on the first successful stat where `size > 5 * 1024 * 1024`, open the file, seek to `size - 5 * 1024 * 1024`, read forward until a `\n` is found, set `storedOffset` to the position after that `\n`, emit a `onStateChange({ skippedOlder: true })` signal.
- [x] 3.6 Wrap every `fs.stat`, `fs.open`, `fs.read` call in try/catch; on `ENOENT` emit `onStateChange({ fileMissing: true })` without throwing; on any other error call `console.error("tailer tick failed", error)` and continue.
- [x] 3.7 Ensure `stop()` clears the interval and closes any file descriptors.

## 4. Dedup-consecutive helper

- [x] 4.1 Create `raycast/src/logs/dedupe.ts` exporting `collapseConsecutive(rows: LogRow[]): DisplayRow[]` that merges consecutive rows whose comparable text (message for structured; full text for raw) is byte-identical into a single `DisplayRow` with fields `{ row, count, firstTime, lastTime }`.
- [x] 4.2 Ensure the function is pure, takes an already-bounded input (≤ 2000 rows), and preserves original row order.

## 5. Severity & visual helpers

- [x] 5.1 Create `raycast/src/logs/severity.ts` exporting a `severityMeta(level: string): { icon: Icon; tint: Color; label: string }` mapping for `ERROR`, `WARNING`, `INFO`, `VERBOSE`, `RAW`, and an unknown fallback. Use Raycast `Icon` and `Color` enums.
- [x] 5.2 Ensure each severity has a distinguishable color (for example ERROR red, WARNING yellow, INFO blue, VERBOSE secondary, RAW tertiary) consistent with the rest of the extension's palette.

## 6. Process-presence hook

- [x] 6.1 Add a reusable `useProcessPresence(profileDir: string, intervalMs = 2000): boolean` hook in `raycast/src/logs/useProcessPresence.ts` that wraps the existing `isProfileInUse` from `src/chromium/processes.ts` in a `setInterval` loop. Return the latest boolean value via `useState`.
- [x] 6.2 Clear the interval on unmount.

## 7. LogViewer component (the main UI)

- [x] 7.1 Create `raycast/src/logs/LogViewer.tsx` accepting `{ profileDir: string }`. Use `<List isShowingDetail navigationTitle={...} searchBarPlaceholder={...} searchBarAccessory={severityDropdown} selectedItemId={...} onSelectionChange={...}>`.
- [x] 7.2 Wire up the tailer (section 3), process-presence hook (section 6), dedup helper (section 4), and parser (section 2) inside a single composed state model. Keep the buffer bounded at 2000 rows and drop oldest on overflow.
- [x] 7.3 Compute `tailerState` per the six-state machine in `specs/log-viewer/spec.md` using the combination of file stat, `profileDir` stat, and `isProfileInUse`.
- [x] 7.4 Render one `<List.Item>` per (deduped) display row with `title` = a short-form message preview (≤ 200 chars, ellipsize), `icon` = severity icon/tint, `accessories` = `[{ tag: "×N" } if N>1, { text: pidOrSource }, { date: ... }]`, and a populated `<List.Item.Detail>` showing the reconstructed raw line plus structured fields via a `Detail.Metadata`.
- [x] 7.5 Render banner items for the non-LIVE states (WAITING, ENDED_PERSISTENT, SWEPT, ORPHANED, LOG_GONE) per their spec scenarios. Condemned-profile banner appears at top when `ENDED_PERSISTENT && autoCleanupRegistry.has(profileDir)`.
- [x] 7.6 Implement actions and shortcuts per the spec:
    - Copy Line (⏎) — `Clipboard.copy`, `Toast.Style.Success`.
    - Copy with Context (⌘⇧C) — ±5 rows, `Toast.Style.Success`.
    - Save Buffer to Downloads (⌘S) — write to `~/Downloads/tempchrome-<basename(profileDir)>-<timestamp>.log`, success toast with ShowInFinder action, failure via `showFailureToast`.
    - Toggle Dedup (⌘D) — success toast "Dedup on" / "Dedup off".
    - Jump to Tail (⌘⇧G) — sets auto-follow back on.
    - Reveal in Finder (⌘⇧O) — hidden in SWEPT/ORPHANED states.
    - Open in Terminal (⌘⇧T) — uses `osascript` to open Terminal.app with `tail -F <logPath>`; hidden in SWEPT/ORPHANED states.
- [x] 7.7 Implement severity-filter dropdown in `searchBarAccessory` with entries All / Errors / Warnings / Info / Raw; default All; filtering happens at render time.
- [x] 7.8 Implement auto-follow behavior: set `selectedItemId` to newest row on each append while auto-follow is on; pause on manual selection change; resume on Jump to Tail. Include `" · paused"` suffix in `searchBarPlaceholder` when paused.
- [x] 7.9 Wrap every effect in proper cleanup (clearInterval, stop tailer) in the `useEffect` return.

## 8. Wire LogViewer into ProfileList

- [x] 8.1 In `raycast/src/profiles/ProfileList.tsx`, import `LogViewer` and add an `Action.Push` titled `"View Log"` with `icon: Icon.Document`, `shortcut={{ modifiers: ["cmd"], key: "l" }}`, and `target={<LogViewer profileDir={profile.path} />}` to every profile row's `ActionPanel`.
- [x] 8.2 Add a `{ tag: "⌘L" }` accessory to each profile row's `accessories` array (in addition to existing "In use" and date accessories).
- [x] 8.3 Ensure the Action appears regardless of whether `chrome_debug.log` exists on disk for that profile (the viewer handles the absent-file case).

## 9. Documentation

- [x] 9.1 Update `raycast/CLAUDE.md` Source Layout tree to include the new `src/logs/` directory and its modules (`LogViewer.tsx`, `parser.ts`, `tailer.ts`, `dedupe.ts`, `severity.ts`, `useProcessPresence.ts`).
- [x] 9.2 Add a short "Logging" subsection to `raycast/CLAUDE.md` documenting that Chromium is launched with `--enable-logging=stderr --log-file=<profileDir>/chrome_debug.log` and that the viewer lives at each profile row (⌘L).
- [x] 9.3 Update the root `CLAUDE.md` (if relevant) or `README.md` with a one-line note that TempChrome now writes a per-profile `chrome_debug.log`.

## 10. Verification

- [x] 10.1 Run `bun run lint` in `raycast/` and fix any findings.
- [x] 10.2 Run `bun run build` in `raycast/` and confirm the extension compiles with no TS errors.
- [x] 10.3 Run `shellcheck cli/tempchrome.sh` (invoke via the project's `verify` skill or directly).
- [ ] 10.4 Manual test in Raycast: launch a profile, navigate Manage Temp Profiles → select profile → press ⌘L → verify the LogViewer opens in WAITING or LIVE and begins tailing; verify dedup collapses repeated lines; verify severity filter works; verify ⌘S writes a file to Downloads.
- [ ] 10.5 Manual test: close the browser while the viewer is open; verify transition to ENDED_PERSISTENT with the correct banner.
- [ ] 10.6 Manual test with `autoCleanup=1`: after Chromium exits and a fresh launch triggers the sweep, verify transition to SWEPT with the correct banner and disabled Reveal/Open actions; verify Save Buffer still works from memory.
- [ ] 10.7 Manual test: with the viewer open and Chromium running, `rm <profileDir>/chrome_debug.log` externally — verify transition to LOG_GONE with the correct banner.
- [x] 10.8 Run `openspec validate add-chromium-log-viewer` and confirm the change is still valid.
