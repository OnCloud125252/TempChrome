## Context

The TempChrome Raycast extension has four related edge-case failures identified in a code walkthrough (see `proposal.md`). All four live at the boundary where the extension's process model (Node/Bun) meets macOS process semantics (detached spawn, `ps` introspection, filesystem rename semantics, HTTP range resumption). None of them is load-bearing on its own, but together they cover the three most damaging user experiences: *"I was told it launched but it didn't"*, *"Install deleted my Chromium and then failed"*, and *"I have to redownload 100 MB after a dropped connection."*

This design doc covers the *how*. Requirements and user-visible scenarios are in `specs/chromium-installer/spec.md` and `specs/quick-launch/spec.md`.

## Goals / Non-Goals

**Goals:**

- `isChromiumBinaryRunning()` returns correct answers for any valid absolute `chromiumPath`, including paths with spaces.
- `launchChromium()` surfaces early-crash signals (wrong arch, Gatekeeper block, broken codesign) to the caller within ~750 ms, so Quick Launch can show a real failure toast instead of a misleading success HUD.
- A cancelled or failed download is resumed on the next attempt via HTTP Range, without requiring the user to redownload from zero.
- `<InstallView />` renders a friendly error when `chromiumPath` has no `.app` segment, instead of throwing during render.
- A destructive swap-step failure (prior bundle deleted, new bundle not in place) results in a user-visible message that names this state and directs the user to re-run Install.

**Non-Goals:**

- Rolling back a failed swap. The product decision is *fail loud, reinstall*; no backup bundle will be kept.
- Replacing fire-and-forget auto-cleanup sweeps with awaited variants.
- Changing the download transport (still `fetch` + `pipeline` + `fs.createWriteStream`).
- Detecting or correcting Chromium crashes that occur *after* the 750 ms grace window.
- Cross-volume atomicity for the swap (already handled via the existing `EXDEV` → `fs.cp` fallback).
- Serializing `LocalStorage` registry writes (deferred to a separate `broaden-error-visibility` proposal).

## Decisions

### 1. Match `ps` lines against the full `chromiumPath` using a prefix check, not a whitespace split

**Context:** `raycast/src/chromium/processes.ts:31` currently does `line.split(/\s+/, 1)[0]`. For `/Applications/My Chromium.app/Contents/MacOS/Chromium`, this returns `/Applications/My`, which never equals the configured `chromiumPath`.

**Decision:** Replace the token-based extraction with a path-prefix match:

```ts
const target = path.resolve(chromiumPath);
return psLines.some((line) => {
  const trimmed = line.trim();
  // Exact match (no args)
  if (trimmed === target) return true;
  // Match followed by argument separator
  return trimmed.startsWith(target + " ");
});
```

The `+ " "` separator prevents false positives on prefix paths (`/Applications/Chromium.app` vs `/Applications/Chromium.app.old`), while correctly matching paths with internal spaces.

**Alternatives considered:**

- *Use `pgrep -lf -- "<escaped path>"`:* avoids custom parsing but adds a subprocess and shell-escaping responsibility, and `pgrep` on macOS matches only against the command name by default unless `-f` is used. Prefix match is simpler and stays in-process.
- *Parse argv from `ps -eo args= | awk`:* `ps args=` output intentionally does not quote paths with spaces, so no awk trick recovers argv[0] reliably.

### 2. `launchChromium` becomes `Promise<void>` with a 750 ms liveness window

**Context:** Current `launchChromium` is synchronous: it spawns detached, unrefs immediately, and returns. Callers have no signal that Chromium actually stayed alive.

**Decision:** Keep `detached: true, stdio: "ignore"` (so Chromium survives the Raycast command exiting), but instead of calling `child.unref()` synchronously:

```ts
export function launchChromium(...): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(chromiumPath, args, { detached: true, stdio: "ignore", env });
    let settled = false;
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new ChromiumLaunchFailedError(code, signal));
    };
    const onError = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      child.unref();
      resolve();
    }, LAUNCH_GRACE_WINDOW_MS);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}
```

The child stays detached during the wait; `unref()` is only called after 750 ms. If the Raycast extension process somehow exits during the grace window (rare — Raycast keeps commands alive), the child is still alive because `detached: true` was set; only the event listeners disappear along with the parent.

**`LAUNCH_GRACE_WINDOW_MS` = 750.** Rationale:

- Gatekeeper denials and codesign failures surface via `exit` within ~100–300 ms on typical hardware. 750 ms provides 2–3× headroom.
- 750 ms is short enough that an animated "Launching TempChrome…" toast does not feel like a UI stall.
- If Chromium hasn't crashed in 750 ms, it is almost certainly past `main()` and into event-loop territory, where we'd need a much longer observer to catch async failures — diminishing returns.

**Alternatives considered:**

- *Capture stderr during the window:* more diagnostic info, but requires `stdio: "pipe"` and a small consume loop to prevent backpressure. Defer until a real user reports a confusing exit-code-only error.
- *Use `child_process.spawn()` with `stdio: "inherit"`:* would stream Chromium's logs to the Raycast process — noisy and useless.

### 3. Download resume via `Range: bytes=N-` into a revision-keyed part file

**Context:** The current installer writes `os.tmpdir()/tempchrome-install-<runId>.zip.part` where `runId = ${Date.now()}-${process.pid}`. That filename is non-resumable by construction. Every failed run creates a new `.part` file.

**Decision:** Move to a stable, revision-keyed filename:

```
<tmpdir>/tempchrome-install-<platform>-<revision>.zip.part
```

The revision is known only after `LAST_CHANGE` is resolved, so the flow becomes:

```
 ┌─────────────────────────────────────────────────────┐
 │  resolve LAST_CHANGE → revision R                   │
 │                                                     │
 │  prune <tmpdir>/tempchrome-install-*.zip.part       │
 │    except tempchrome-install-<platform>-R.zip.part  │
 │                                                     │
 │  partPath = tempchrome-install-<platform>-R.zip.part│
 │  partSize = existsSync(partPath) ? stat.size : 0    │
 │                                                     │
 │  if partSize > 0:                                   │
 │      fetch(url, { headers: { Range: bytes=N- }})    │
 │        → 206 Partial Content: append to partPath    │
 │        → 200 OK: server ignored range → truncate    │
 │        → 416 Range Not Satisfiable: delete + restart│
 │  else:                                              │
 │      fetch(url)                                     │
 │      → 200 OK: fresh write to partPath              │
 │                                                     │
 │  rename(partPath → zipPath)                         │
 │  extract, swap, xattr, cleanup                      │
 │                                                     │
 │  on success: rm(partPath), rm(zipPath)              │
 │  on abort/failure before rename: KEEP partPath      │
 └─────────────────────────────────────────────────────┘
```

Key detail: the pruning step runs *after* revision resolution, so we only delete genuinely stale parts. If a user interrupts two installs across a revision bump, the first part is pruned on the second attempt — they lose that progress, but there is nothing to resume against the new revision anyway.

**Write-stream mode:**

- Fresh download: `fs.createWriteStream(partPath, { flags: "w" })`.
- 206 resume: `fs.createWriteStream(partPath, { flags: "a" })`.
- 200 ignored-range: `fs.createWriteStream(partPath, { flags: "w" })` (truncate).

The `onProgress` callback must receive `bytesDownloaded` including the resumed bytes so the progress bar and ETA are correct. That means seeding `bytesDownloaded = partSize` when resuming.

**Alternatives considered:**

- *Use `If-Range` with an ETag:* more robust against mid-resume content changes, but snapshot URLs at `<revision>/chrome-mac.zip` are immutable in GCS — the revision path already provides immutability. Skip the extra header.
- *Keep the existing `runId`-keyed name and add a resume-index sidecar:* two files to manage, easy to diverge. Revision-keyed name is simpler.
- *Store part file in a stable cache dir (`~/Library/Caches/...`):* survives OS tmp pruning, but also survives user intent to "just delete it"; users expect `/tmp` to be disposable. Stay with `os.tmpdir()`.

### 4. Render-safe bundle resolution in `<InstallView />`

**Context:** `InstallView.tsx:242` calls `appBundleFromBinary(chromiumPath)` at render. A malformed preference throws synchronously; Raycast displays a generic "Command failed" screen with no remediation.

**Decision:** Wrap the call in a `useMemo` that captures the throw as a state value:

```ts
const appBundleResult = useMemo(() => {
  try {
    return { ok: true, path: appBundleFromBinary(chromiumPath) } as const;
  } catch (error) {
    return { ok: false, error: error as Error } as const;
  }
}, [chromiumPath]);
```

If `appBundleResult.ok === false`, render a `<Detail>` with a friendly message, a Close action, and a `showFailureToast` call in a `useEffect`. If `ok === true`, continue with the existing install pipeline.

**Alternatives considered:**

- *Validate `chromiumPath` at the preference boundary in `getPreferences()`:* better UX in principle (surface the error before the install command even opens) but requires reworking `getPreferences` to return a result object, which would ripple through every caller. Defer.

### 5. Swap-failure messaging is copy + error-class, not rollback

**Decision:** Augment `InstallPathError` callers at the swap step to prepend `"Chromium bundle at <appBundlePath> is no longer present."` to the message, and add a check in `<InstallView />`'s failure-state markdown to surface this as its own remediation paragraph when the error message matches.

No new error class is introduced because `InstallPathError` already exists and the distinction is in the message, not the type. If a future contributor wants a typed discriminator, `error.cause` or a boolean `priorBundleDeleted` property on `InstallPathError` is an easy follow-up.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Liveness window is racy for slow startup.** A very cold-start Chromium on spinning-disk hardware could take longer than 750 ms to crash. | 750 ms is generous vs. observed failure modes. If evidence emerges of legitimate slow crashes, tune the constant; no code shape change needed. |
| **Range-resume corrupts the zip if the server returns the wrong range.** Partial response with wrong byte range would append garbage. | Always check `response.status === 206` and the `Content-Range` header's start byte equals `partSize`. If headers don't agree, treat as `200 OK` (truncate + fresh). |
| **Prefix match still tricks on symlinks.** `chromiumPath = /Users/alice/Applications/Chromium.app/...`, Chromium was launched via `/Applications/Chromium.app/...` (symlinked). | `path.resolve` does not follow symlinks. If a user reports a miss, add `fs.realpath` normalisation on both sides. Low priority for now. |
| **Part file accumulation if tmpdir is never pruned.** An aggressive user who cancels many installs across revisions could accumulate `.part` files from revisions pruned at next attempt, but only one stale part at a time is possible per platform (we prune on each run). | Pruning step is idempotent; worst case is one 50-100 MB stale file, cleared on the next install. |
| **InstallView render guard could swallow non-bundle errors.** Wrapping `appBundleFromBinary` in try/catch catches *any* error. | The function only throws one kind of error (`"No .app bundle segment found in path: ..."`); other failures would mean a programming bug that should crash anyway. Accept. |

## Migration Plan

Single-commit, no feature flag needed. All changes are internal and backward-compatible from the user's perspective:

1. Merge the `processes.ts` prefix-match fix first (smallest diff, unblocks correct preflight behavior).
2. Merge the `launchChromium` async signature change together with every call site update (`launch.ts`, `Tempchrome.tsx`, `ProfileList.tsx`). This is a **BREAKING** internal API change — both sides must land atomically.
3. Merge the download-resume changes (installer + new part-file naming + pruning).
4. Merge the InstallView render guard and the swap-failure copy.

Rollback is `git revert` on each commit; no persisted state is changed. Stale `.part` files in `os.tmpdir()` from the old `runId`-keyed naming are caught by the new pruner (their prefix is the same: `tempchrome-install-*.zip.part`).

## Open Questions

1. **Should we show the resumed-bytes count in the InstallView metadata pane?** e.g. `Resumed from 48.2 MB`. Nice-to-have; not required by any spec scenario.
2. **Do we want a "Reset install cache" action** in the InstallView ActionPanel to let users purge all `.part` files manually? Easy to add but arguably unnecessary given the revision-keyed pruning.
3. **Grace window configurability** — should `LAUNCH_GRACE_WINDOW_MS` become a hidden preference, or stay a constant? Default to constant; revisit if real users report false failures.
