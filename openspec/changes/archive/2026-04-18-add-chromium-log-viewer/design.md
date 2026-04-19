## Context

TempChrome currently launches Chromium via `child_process.spawn(chromiumPath, args, { detached: true, stdio: "ignore", env })` in `raycast/src/chromium/launcher.ts:74`. Because `stdio` is `"ignore"` and no `--enable-logging` flag is passed, every stderr line Chromium writes is discarded, and the file-based `chrome_debug.log` is never created. Users who need to debug page behavior, extension errors, or Chromium-level issues have no way to see any diagnostic output from inside Raycast. The CLI path (`cli/tempchrome.sh`) inherits stdio, but Chromium is silent by default without the logging flag, so the CLI is only marginally better.

The Raycast extension is already organized by domain under `raycast/src/` (`chromium/`, `profiles/`, `options/`, `utils/`). A log viewer lands cleanly as a new `logs/` domain next to the existing ones, and its entry point hangs off the existing `profiles/ProfileList.tsx` which already enumerates every profile directory.

A representative sample of Chromium's stderr output (collected by the user while this design was being explored) shows:

- Timestamp + metadata format: `[PID:TID:MMDD/HHMMSS.micro:LEVEL:source_file:line] message`
- Bursts of 20+ near-identical lines within ~50 ms (GPU "Invalid mailbox" spam)
- Lines from Apple frameworks (NSLog) that do not follow the Chromium format
- Non-atomic interleaved writes from multiple PIDs producing garbled fragments
- Mostly ERROR-level content; `--v=1` is not needed for the common case

Any viewer design has to tolerate all four simultaneously.

## Goals / Non-Goals

**Goals:**

- Make Chromium's stderr + `chrome_debug.log` visible inside Raycast without the user leaving the extension.
- Give the CLI parity so users running `tempchrome` in a terminal also see live stderr and get a file on disk.
- Tie log file lifetime to profile lifetime: put the log inside `<profileDir>/chrome_debug.log` so the existing `--auto-cleanup` sweep removes it for free.
- Make the viewer tolerate real-world log pathologies: bursts, garbled lines, partial reads, mid-multibyte-UTF8 reads, truncation, inode swaps, and filesystem races.
- Use Raycast-idiomatic primitives so the feature blends with the existing UX (keyboard shortcuts, toast feedback, List + Detail split view).
- Keep the v1 surface small: no preferences, no new commands, no new dependencies.

**Non-Goals:**

- Recovering log bytes written after the log file has been unlinked while Chromium keeps writing to its open `fd`. macOS has no `/proc/<pid>/fd/N` equivalent; recovering bytes from an unlinked file requires platform-specific tools (`lsof` + `pread` on raw fds, or `pcat`) and is out of scope for v1.
- Capturing web page `console.log` output or extension service-worker logs — those stay in DevTools and are not written to `chrome_debug.log`.
- Parsing crash dumps in `Crashpad/`. Surfacing crash reports is a plausible v2 enrichment but not in this change.
- Rotating, trimming, or exporting log files automatically. If a session's log is large, the viewer truncates the *view* (last 5 MB on first open, 2000-line in-memory cap) while the *file* stays whole.
- User-configurable verbosity. `--v=0` (the Chromium default) produces enough signal for the ERROR lines our sample showed; adding a toggle introduces UI without clear value.
- Supporting non-local filesystems for `tempBaseDir` (SMB/NFS). Inode and mtime semantics vary; we target local APFS/HFS+.

## Decisions

### Decision: Write logs inside each profile directory, not a separate logs dir

**Why:** Chromium already honors `--log-file=<path>` and, when combined with `--user-data-dir=<path>`, naturally puts the log beside the rest of the profile's state. Placing it inside `<profileDir>/chrome_debug.log` means:

- Log lifetime = profile lifetime. The existing `autoCleanup` sweep removes it automatically.
- No new directory management code (`~/Library/Logs/TempChrome/` with its own rotation policy).
- No new preferences.
- File inherits the profile's `0o700` permissions, so logs are not world-readable.
- Each launch gets a pristine log (fresh profile dir → fresh log) — no rotation needed.

**Alternatives considered:**

- `~/Library/Logs/TempChrome/<profile-id>.log` — survives auto-cleanup, but adds cleanup policy, preferences surface, and decouples log from profile. Rejected: more code, weaker lifecycle.
- Capture stderr from the spawned Chromium via a pipe in `launchChromium()` — would require a live Node process to stay alive alongside detached Chromium, which defeats the purpose of `detached: true` + `child.unref()`. Rejected: fundamentally incompatible with the current spawn design.

### Decision: Pass both `--enable-logging=stderr` and an explicit `--log-file=<profileDir>/chrome_debug.log`

**Why:** `--enable-logging=stderr` alone sends output to stderr (lost in the Raycast spawn). `--enable-logging` without a value has platform-dependent behavior that has shifted between Chromium builds on macOS. Passing both an explicit mode *and* an explicit file path eliminates the ambiguity and gets us stderr (for the CLI) plus a file (for the Raycast viewer) simultaneously.

**Alternatives considered:**

- `--enable-logging` only — works on recent macOS builds, but relies on the default path ending up under `user-data-dir`. Rejected: explicit beats implicit for a feature we expect to run forever.
- Splitting into `--enable-logging` for the CLI and `--enable-logging=stderr --log-file=…` for Raycast — extra branching in `buildArgs` for no gain. Rejected.

### Decision: The `--log-file` value is computed at launch time, not in `BASE_CHROMIUM_ARGS`

**Why:** The log path depends on the freshly created profile directory, which is only known after `createTempProfile()` runs. Putting a templated value in `src/chromium/constants.ts` would require a runtime substitution step that doesn't exist today. Instead, append the log-file arg inside `launchChromium()` in `src/chromium/launcher.ts` right next to where `--user-data-dir` is templated in — the two flags have the same data dependency so keeping them together documents the relationship.

### Decision: Stat-based polling for the tailer, not `fs.watch`

**Why:** `fs.watch` on macOS is known to miss filesystem events for log-file appends (it's built on kqueue and fires reliably only for VNODE events like rename/delete, not for writes). `fs.watchFile` works but is itself polling-based under the hood. A direct `setInterval` + `fs.stat` loop at 250 ms:

- Is deterministic and testable.
- Costs ~4 stat syscalls/sec/viewer, which is negligible.
- Gives us the same loop to check for truncation, inode swap, and deletion with no extra code.
- Lets us batch state updates: multiple line arrivals in one tick coalesce into one React re-render.

**Alternatives considered:**

- `fs.watchFile` with default polling — same complexity, less visibility into the polling cadence. Rejected: prefer explicit control.
- `tail -f` subprocess — adds a process per viewer, subtle lifecycle issues with Raycast's unmount. Rejected.

### Decision: Offset-based read, with first-open seek-skip for logs ≥ 5 MB

**Why:** The 2000-line in-memory cap means we do not need (or want) the entire history of a long session. On first open of an existing log, we measure size; if `size > 5 MB` we skip to `size - 5 MB`, advance to the next `\n`, and start tailing from there. For small files we read everything. This keeps first-render latency bounded regardless of how long Chromium has been running and how noisy it was.

**Trade-off:** The user loses the oldest lines on first open of a large historical log. Mitigation: "Reveal in Finder" action gives them the whole file in an editor.

### Decision: Regex parser with a first-class RAW fallback

**Why:** The Chromium format `^\[(\d+):(\d+):(\d{4})\/(\d{6})\.(\d+):([A-Z]+):([^:]+):(\d+)\] (.*)$` is stable and strict — unmatched lines always fall back to `type: "raw"` rather than partial-match gymnastics. Our sample showed three sources of unmatched lines (Apple NSLog, preamble text, interleaved garbled fragments from concurrent PIDs); all of them are better displayed verbatim as RAW than forcibly coerced into a structured shape that would be wrong.

RAW lines participate in every viewer feature (dedup, Copy, search) except structured-field rendering.

### Decision: Consecutive-duplicate dedup on by default

**Why:** The user's sample had 20 consecutive `SharedImageManager::ProduceOverlay: Invalid mailbox` lines within 50 ms. At best these confuse a reader; at worst they drown out the one interesting line around them. Collapsing them to a single item with `×20` badge keeps the list scannable. Dedup does not mutate the in-memory buffer — toggling off via ⌘D reveals the individual rows unchanged.

**Rationale for default-on vs. default-off:** The common case after looking at real log output is "I want to read this"; the common case after toggling dedup off is "I'm writing a bug report and need the exact count and timestamps" — which is rarer. Default-on matches the common case.

### Decision: List + Detail split view, not Detail markdown

**Why:** The viewer's data is a long sequence of short, structured rows — a perfect match for `<List>` with one `<List.Item>` per (deduplicated) entry. Compared to a `<Detail>` markdown blob:

| Capability           | `<List>` + Detail  | `<Detail>` markdown     |
|----------------------|--------------------|-------------------------|
| Search               | built-in           | none                    |
| Per-item actions     | trivial            | impossible              |
| Accessories          | PID / level / `×N` | inline markdown only    |
| Keyboard navigation  | built-in           | manual                  |
| Live append          | cheap              | full markdown re-parse  |
| Memory at 2000 lines | OK                 | OK                      |
| Memory at 10k lines  | risky              | very risky              |

The Detail pane on the right is used for the *selected* row only (full raw line + structured fields + time span for deduped rows), giving us the best of both.

### Decision: Six-state tailer machine, driven by `fs.stat` + `isProfileInUse`

**Why:** The viewer has to represent every combination of {profile dir exists, log file exists, Chromium running}. The reachable combinations collapse to six states (see specs/log-viewer/spec.md for the exhaustive list). Each state has a distinct banner and action set. Trying to compress this into a "running / ended" boolean would hide real information from the user — in particular the SWEPT vs. ENDED_PERSISTENT distinction determines whether "Reveal in Finder" even works.

The process-presence check (`isProfileInUse`) runs on its own 2-second interval, not inside the 250 ms tailer loop, because `ps` is more expensive than `fs.stat`.

### Decision: Condemned-profile warning banner for `autoCleanup=1 && ENDED_PERSISTENT`

**Why:** The `autoCleanup` sweep runs on the *next launch*, not on Chromium exit. So a user can close the browser, walk away, come back, open the viewer — and the log is still there. Then they launch another profile and the sweep silently nukes the one they were reading. The banner gives the user a chance to ⌘S save the buffer before committing to another launch.

**Alternatives considered:**

- Hold off the sweep while a viewer is open — requires a new hold registry with TTLs, leak handling on Raycast crashes, and introduces a failure mode (orphaned holds blocking cleanup forever). Rejected: too much machinery for one edge case.
- Silently copy the log to `~/Library/Logs/TempChrome/` before sweep — adds the cleanup-policy burden we explicitly decided to avoid. Rejected.

### Decision: Save Buffer writes to `~/Downloads/` as newline-joined plain text

**Why:** `~/Downloads/` is the unambiguously-correct macOS destination for user-initiated saves. Plain text (not JSON) matches what the user expects from a `.log` file and keeps the output usable with `grep`, `less`, or anything else. Raw rows use their source text verbatim; structured rows are reconstructed to the canonical `[pid:tid:date/time.µ:LEVEL:file:line] message` form.

## Risks / Trade-offs

- [**Risk**] macOS stderr writes from multiple Chromium processes can interleave at sub-line granularity, producing garbled lines (as in the user's sample, line 4). → **Mitigation**: parser falls back to `type: "raw"` and displays verbatim; we do not attempt to "repair" garbled lines.

- [**Risk**] On `autoCleanup=1`, the sweep removes the log file the next time anything launches. A user mid-read loses their data. → **Mitigation**: condemned-profile banner warns on `ENDED_PERSISTENT`; Save Buffer action is one keystroke; we accept this as a trade-off since auto-cleanup is the documented ephemerality mode.

- [**Risk**] External `rm` of `chrome_debug.log` while Chromium is still running leaves Chromium writing to an unlinked inode that we can't follow on macOS. → **Mitigation**: surface LOG_GONE state with banner "restart Chromium to resume logging"; we do not attempt `lsof`-based recovery.

- [**Risk**] Long sessions could accumulate a multi-GB `chrome_debug.log` on disk (only limited by `/tmp` free space). → **Mitigation**: accept; the file is inside `$PROFILE_DIR` and disappears with the profile. Document in CLAUDE.md that extraordinarily long sessions will bloat the temp profile directory.

- [**Risk**] A pathological line without a terminating newline grows unboundedly in the tailer's partial-line buffer. → **Mitigation**: 64 KB cap on the partial-line buffer; flush as `raw` with a `⚠ truncated` marker and reset.

- [**Risk**] UTF-8 multi-byte characters split across read boundaries produce replacement characters. → **Mitigation**: feed bytes through `node:string_decoder.StringDecoder("utf8")` which buffers incomplete sequences across ticks.

- [**Risk**] React re-renders on every 250 ms append could slow down the UI during GPU-error bursts. → **Mitigation**: dedup-consecutive coalesces most of the traffic; the 2000-line cap bounds the size of the rendered array; setState is batched by React within a tick.

- [**Risk**] `isProfileInUse` runs `ps -Ao args=` every 2 seconds per viewer. Multiple viewers compound this. → **Mitigation**: acceptable for v1 (most users will have one viewer at a time); if we ever need to, memoize the `ps` output with a module-level 1-second TTL shared across viewers.

- [**Trade-off**] We drop the oldest 5 MB+ of a very long existing log on first open. A user who needs older history must use "Reveal in Finder" and open the file in an editor. Acceptable because the file is still intact — we only limit the view.

- [**Trade-off**] Logging is always on, so every launch writes a file. In the common case this is fine (file is small, auto-cleaned). For extremely long sessions with `--auto-cleanup` off, the file accumulates. This is the same trade-off a user makes by keeping any temp profile long-lived; not a new concern.

## Migration Plan

This change has no migration in the traditional sense — it's additive.

- **Deployment** is a single release: new Raycast extension version + `cli/tempchrome.sh` update. There is no server side, no data schema change, no config change.
- **Rollback** is trivial: remove the two flags from `launchChromium()` and `cli/tempchrome.sh`; remove the new `src/logs/` directory; remove the View Log action from `ProfileList.tsx`. No state to clean up beyond any `chrome_debug.log` files that were written — these are inside temp profiles and will be auto-cleaned by normal profile lifecycle, or can be left in place with no effect (Chromium regenerates them on next launch of the same profile, but TempChrome always creates new profiles, so there is no next launch for any given profile).
- **Forward compatibility**: profiles created before this change do not have `chrome_debug.log`. The viewer handles this gracefully via the "No log file found" state described in the log-viewer spec.

## Open Questions

None blocking implementation. The user has answered the four open questions raised during exploration:

1. Cap strategy: 2000-line in-memory cap with "Reveal in Finder" escape hatch — confirmed.
2. Dedup default: on, togglable with ⌘D — confirmed.
3. Severity default: all — confirmed.
4. Logging mode: always on (no user-facing toggle) — confirmed.

Defaults baked into v1 (not previously spelled out explicitly):

- Save Buffer to Downloads action included in v1 (rather than deferred to v2 as originally sketched).
- Condemned-profile warning banner included in v1 (rather than relying purely on the generic "Session ended" banner).
- Poll cadence: 250 ms tailer, 2000 ms process-presence check.

If any of these turn out to be wrong in practice, each is a one-screen change and can be adjusted without touching the spec contract.
