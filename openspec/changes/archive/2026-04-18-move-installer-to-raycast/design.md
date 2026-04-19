# Design — move-installer-to-raycast

## Goals

1. Run the full Chromium install pipeline inside the Raycast extension process, with no Terminal.app hop.
2. Show live, cancellable progress in a Raycast-native `<Detail>` view.
3. Decouple the default install target from the user's general-purpose Chromium in `/Applications`.
4. Remove the now-redundant `--install` branch from the shell CLI.

## Non-goals

- Providing a pure-TS unzip. We shell out to `/usr/bin/unzip` (macOS base system) — reliable, zero-dep.
- Providing a pure-TS xattr clear. We shell out to `/usr/bin/xattr`.
- Supporting platforms other than macOS. The entire project is macOS-only.
- Supporting code-signed / notarized installs. We clear quarantine with `xattr -cr`, matching the shell script's behavior.
- Restoring the deleted `/Applications/Chromium.app` or any pre-existing bundle at the target path. `fs.rm` is permanent, per project convention (`CLAUDE.md` overrides the `trash` rule for TS/JS code).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Raycast Extension Process                  │
│                                                                 │
│  Tempchrome.tsx  ──Action.Push──▶  InstallView.tsx              │
│                                        │                        │
│                                        │ mounts                 │
│                                        ▼                        │
│                                  runInstall({                   │
│                                    onProgress,                  │
│                                    signal: abort.signal,        │
│                                    chromiumPath: prefs.path,    │
│                                  })   │                         │
│                                       │ stages: fetch → dl →    │
│                                       │ extract → swap → xattr  │
└───────────────────────────────────────┼─────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ storage.googleapis.com   │   │ /usr/bin/unzip           │
│   LAST_CHANGE (GET)      │   │ /usr/bin/xattr           │
│   chrome-mac.zip (GET)   │   │ fs.rm, fs.cp, fs.rename  │
└──────────────────────────┘   └──────────────────────────┘
```

The installer is split into two layers on purpose:

- **`src/chromium/installer.ts`** — the pure module. No React, no Raycast UI. Exports `runInstall(opts)`. Takes `onProgress` and `signal`. Returns `{ revision }` on success. Easy to unit-test (or at minimum, to eyeball-debug) because it has no hidden dependency on the Raycast runtime.
- **`src/install/InstallView.tsx`** — the thin presentation layer. Owns the `AbortController`, renders markdown + `navigationTitle`, wires the "Cancel" action, maps progress events to toast/title updates, calls `showFailureToast` on rejection.

## Progress event shape

```ts
type InstallProgress =
  | { stage: "resolve-revision" }
  | { stage: "download"; bytesDownloaded: number; bytesTotal: number | null; revision: string }
  | { stage: "extract"; revision: string }
  | { stage: "preflight"; revision: string }      // check running processes, existing bundle
  | { stage: "swap"; revision: string }           // delete old + move new into place
  | { stage: "xattr"; revision: string }
  | { stage: "cleanup"; revision: string }
  | { stage: "done"; revision: string };
```

`InstallView` holds the most recent `InstallProgress` in state and throttles re-renders by only updating when the stage changes OR `bytesDownloaded` has advanced by ≥ 1 % of `bytesTotal` OR ≥ 250 ms has elapsed since the last render. Without the throttle, a fast connection generates thousands of fetch chunks per second and pins the reconciler.

## Pipeline, step by step

### 1. Preflight

- Derive `appBundlePath` from `prefs.chromiumPath` via `appBundleFromBinary()`. If the preference is the default, this yields `~/Applications/Chromium.app` (with `~` already expanded by `getPreferences()`).
- Ensure the parent directory of `appBundlePath` exists (`fs.mkdir` recursive). For the default, this creates `~/Applications` on first install.
- Run `isChromiumBinaryRunning(prefs.chromiumPath)` (new helper in `processes.ts`). If any `ps` row matches, abort early with a typed error `ChromiumRunningError` — the UI maps this to a failure toast with title `"Chromium is running"` and a hint to quit first.

### 2. Resolve revision

- `fetch("https://storage.googleapis.com/chromium-browser-snapshots/<platform>/LAST_CHANGE", { signal })`.
- `platform = process.arch === "arm64" ? "Mac_Arm" : "Mac"`.
- Response body is plain text — `await res.text()` then `trim()`.
- Emit `{ stage: "resolve-revision" }` at entry.

### 3. Stream download

- URL: `https://storage.googleapis.com/chromium-browser-snapshots/<platform>/<revision>/chrome-mac.zip`.
- `fetch(url, { signal })` → `res.body.getReader()`.
- Create `zipPath = path.join(os.tmpdir(), "tempchrome-install-<revision>.zip.part")`. Open `fs.createWriteStream(zipPath)`.
- Read chunks in a `for await` loop, `write()` each to the stream, accumulate `bytesDownloaded`.
- `bytesTotal = parseInt(res.headers.get("content-length") ?? "", 10) || null`.
- On loop exit, `await stream.end()`. Rename `zipPath` → `zipPath.replace(/\.part$/, "")`. The rename is atomic within `/tmp/`, guaranteeing we never leave a truncated file with the final name.
- Emit `{ stage: "download", ... }` throttled as described above.

### 4. Extract

- `extractDir = path.join(os.tmpdir(), "tempchrome-install-<revision>")`. `fs.rm` recursively first (in case of stale state from a prior failed run), then `fs.mkdir`.
- `spawn("/usr/bin/unzip", ["-oq", zipPath, "-d", extractDir])`. Wait for `close`. If exit code ≠ 0, throw `ExtractionError` carrying the stderr buffer.
- Verify `fs.stat(path.join(extractDir, "chrome-mac/Chromium.app"))` exists and is a directory. If not, throw `ExtractionError("Chromium.app not in archive")`.

### 5. Swap

- Re-check `isChromiumBinaryRunning(prefs.chromiumPath)` — narrow but real race between preflight and here. If it came back, abort with `ChromiumRunningError`.
- `fs.rm(appBundlePath, { recursive: true, force: true })` — permanent delete of the old `.app` if it exists.
- Try `fs.rename(path.join(extractDir, "chrome-mac/Chromium.app"), appBundlePath)`. If it fails with `EXDEV` (cross-filesystem — possible if the user's home is on a different APFS volume than `/tmp/`), fall back to `fs.cp(..., { recursive: true, force: true })` then `fs.rm(source, { recursive: true, force: true })`.

### 6. Clear quarantine

- `spawn("/usr/bin/xattr", ["-cr", appBundlePath])`. Wait for close. Non-fatal if it fails (log to console and continue); Chromium will simply prompt on first launch.

### 7. Cleanup

- `fs.rm(extractDir, { recursive: true, force: true })`.
- `fs.rm(zipPath, { force: true })`.
- Emit `{ stage: "done", revision }`.

## UI rendering

### Markdown body (InstallView)

Rendered live from current progress state. Example at peak:

```md
# Installing Chromium

**Revision** 1246328
**Target**   /Users/alice/Applications/Chromium.app

## Progress

Stage: **Downloading**

`▓▓▓▓▓▓▓▓░░░░░░░░░░░░  42%  ·  86.3 / 204.7 MB`
```

Progress bar is fixed-width (20 chars) using `▓` and `░`. When `bytesTotal === null`, substitute `spinner + " " + bytesDownloaded MB` without the bar.

### Navigation title

`"Installing Chromium · ${percent}%"` during download; `"Installing Chromium · ${stage}"` otherwise.

### Actions

- **Cancel** (`⌘.`) — calls `abortController.abort()`, flips view state to `"cancelled"`, shows failure toast `"Install cancelled"`. The in-flight fetch rejects with an `AbortError`; any spawned subprocess is `.kill()`-ed.
- **Copy Error Details** — only when state is `"failed"`, copies stage + error message + stack to clipboard.
- **Close** — `popToRoot()` when the install is terminal (done / failed / cancelled).

### Toasts

Per the repo's UX policy (toasts are mandatory), the view shows:

- Initial animated toast on mount: `"Resolving latest Chromium revision…"`.
- Success toast on done: `"Chromium <revision> installed"`.
- Failure toast on any error: routed through `showFailureToast(error, { title: errorTitle(err) })`.

## Error model

```ts
class ChromiumRunningError extends Error { /* title: "Chromium is running" */ }
class NetworkError extends Error { /* title: "Download failed" */ }
class ExtractionError extends Error { /* title: "Extraction failed" */ }
class InstallPathError extends Error { /* title: "Could not write to install path" */ }
class AbortedError extends Error { /* title: "Install cancelled" */ }
```

The pure `runInstall()` module throws these typed errors; `InstallView` maps them to titled toasts. Abort via `AbortController` surfaces as `DOMException { name: "AbortError" }` from `fetch`; the view wraps that into `AbortedError` before re-throwing to the toast layer.

## Default path change

Before: `chromiumPath` defaults to `/Applications/Chromium.app/Contents/MacOS/Chromium`.
After:  `chromiumPath` defaults to `~/Applications/Chromium.app/Contents/MacOS/Chromium`.

Raycast preferences are plain strings — Raycast does not expand `~`. `src/preferences.ts`'s `getPreferences()` helper will expand a leading `~/` or `~` to `os.homedir()` before returning. Both `chromiumPath` and `tempBaseDir` pass through this expansion for consistency.

`~/Applications` does not exist on a fresh macOS install. The installer creates it with `fs.mkdir(parent, { recursive: true })` during preflight. Finder treats `~/Applications` as a first-class apps location (Spotlight indexes it, Launchpad shows apps placed there if the user adds them), so this is a conventional choice.

## CLI removal

`cli/tempchrome.sh` currently carries ~75 lines of install-related code (the `install_chromium()` function and its argument parsing). All of it is deleted:

- `SNAPSHOT_BASE_URL` constant → removed.
- `detect_arch()` function → removed (only used by installer).
- `install_chromium()` function → removed.
- `--install|--update` case branch in argument parser → removed.
- `--install, --update` line in `usage()` → removed.
- The "Chromium not found" hint is reworded: instead of `"Install with: tempchrome --install"`, it says something like `"Install Chromium via the Raycast command 'Install or Update Chromium…' from the TempChrome extension."`.

The root `README.md` install section is rewritten to describe the Raycast flow only. Any mention of `tempchrome --install` or `tempchrome --update` is removed.

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Fast download chunks pin React reconciler | Throttle progress events to max 1/250 ms OR 1% delta |
| Partial download at final path if process dies | Stream to `<zip>.part`, rename only on success |
| Race: Chromium launches between preflight and swap | Re-check `isChromiumBinaryRunning` immediately before `fs.rm(appBundlePath)` |
| Cross-volume rename fails (`EXDEV`) for home-on-different-APFS users | Fallback `fs.cp` + `fs.rm` path |
| `~/Applications` doesn't exist | `fs.mkdir(parent, { recursive: true })` during preflight |
| User still running old Chromium at `/Applications/Chromium.app` when they upgrade | Preference migration is manual; README documents how to point `chromiumPath` back at the old location if the user prefers |
| `xattr` or `unzip` missing (would be a very broken macOS) | Spawn failure surfaces as typed error → failure toast; install is aborted with a clear message |
| AbortController mid-`unzip` leaves half-extracted dir | Cleanup step uses `fs.rm(extractDir, { recursive: true, force: true })`; `InstallView`'s cancel handler also runs this cleanup on abort |

## Open questions (nothing blocking)

- Should we eventually write an **installed-revision marker** (e.g. `~/Applications/Chromium.app/.tempchrome-revision`) so the next invocation can show "You already have revision N; latest is M. Update?" Not in scope for this change — would be a nice follow-up.
- Should the install view offer a **Retry** action on failure? Useful but adds cancellation-state plumbing. Out of scope; user can just trigger the command again.
