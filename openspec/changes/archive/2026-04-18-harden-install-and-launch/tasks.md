## 1. Fix ps-based process matching

- [x] 1.1 Replace the whitespace-split strategy in `raycast/src/chromium/processes.ts`'s `isChromiumBinaryRunning` with a path-prefix match (trimmed line equals `target`, or trimmed line starts with `target + " "`).
- [x] 1.2 Add a `path.resolve(chromiumPath)` normalisation at the top of `isChromiumBinaryRunning` so callers can pass either the raw preference value or a pre-resolved path.
- [ ] 1.3 Hand-exercise the new matcher by running a Chromium instance from a path containing a space and verifying the install preflight blocks correctly.
- [ ] 1.4 Hand-exercise the prefix-trap case: rename a second install to `Chromium.app.old`, launch it, confirm the current install is not blocked by the `.old` process.

## 2. Replace fire-and-forget launch with a liveness-checked async launch

- [x] 2.1 Add a `LAUNCH_GRACE_WINDOW_MS = 750` constant to `raycast/src/chromium/constants.ts`.
- [x] 2.2 Add a typed `ChromiumLaunchFailedError` class to `raycast/src/chromium/launcher.ts` exposing `exitCode: number | null` and `signal: NodeJS.Signals | null` fields, with a message that includes both.
- [x] 2.3 Change `launchChromium` to return `Promise<void>`; register `exit` and `error` listeners, start a 750 ms timer, and resolve-and-unref only if the timer fires first. Ensure the listeners are removed on resolve to avoid leaks.
- [x] 2.4 Update `raycast/src/launch.ts` `launchWithValues` to `await launchChromium(...)` and route rejections through `showFailureToast` with title `"Launch failed"`.
- [x] 2.5 Update `raycast/src/Tempchrome.tsx` `handleLaunch` so the animated "Launching TempChrome…" toast covers the grace window (no early hide) and transitions to Failure on rejection.
- [x] 2.6 Update `raycast/src/profiles/ProfileList.tsx` `handleRelaunch` to `await launchChromium(...)`, handle rejection, and keep the animated toast visible for the grace window.
- [x] 2.7 Verify Quick Launch from the hotkey (`src/launch.ts` default export) still feels responsive — show a leading `showHUD("Launching TempChrome…")` before awaiting, then the success HUD after.
- [ ] 2.8 Hand-test the failure path: temporarily break the Chromium bundle (e.g., `chmod -x` the Chromium binary) and confirm a failure toast appears instead of the success HUD.

## 3. Implement download resume via HTTP Range

- [x] 3.1 Introduce a `partPathFor(platform, revision)` helper in `raycast/src/chromium/installer.ts` returning `path.join(os.tmpdir(), \`tempchrome-install-${platform}-${revision}.zip.part\`)`.
- [x] 3.2 Add a `pruneStaleParts(platform, revision)` helper that `readdir`s `os.tmpdir()`, matches `/^tempchrome-install-(Mac|Mac_Arm)-(\d+)\.zip\.part$/`, and deletes every entry whose `(platform, revision)` does not match the current run.
- [x] 3.3 Call `pruneStaleParts` once inside `runInstall`, immediately after the revision is resolved and before starting the download.
- [x] 3.4 Refactor `streamDownloadToFile` to accept a `resumeFromBytes` parameter and a write-stream `flags` parameter. Seed the initial `bytesDownloaded` in the progress callback to `resumeFromBytes`.
- [x] 3.5 Before `streamDownloadToFile`, check if `partPath` exists; if `stat.size > 0`, set `resumeFromBytes = stat.size` and issue the fetch with `headers: { Range: \`bytes=${resumeFromBytes}-\` }`.
- [x] 3.6 Branch on the response status: `206` → open partPath with flag `"a"`, seed `bytesDownloaded`; `200` → open partPath with flag `"w"`, reset `bytesDownloaded = 0`; `416` → `rm` partPath and retry the download exactly once without the Range header; other non-2xx → `NetworkError`.
- [x] 3.7 When the response is `206`, validate the `Content-Range` response header's start byte equals `resumeFromBytes`; if it does not, treat as `200` (truncate + fresh write).
- [x] 3.8 Remove the `.part` cleanup from the `finally` block in `runInstall`; replace it with an explicit `rm(partPath)` inside the success path, after `rename(partPath, zipPath)` but before extraction. (Extraction failure should NOT leave a part file behind if the rename already moved it to `.zip`.)
- [x] 3.9 Keep the existing `.zip` and `extractDir` cleanup in `finally`; those are unrelated to the resume story.
- [ ] 3.10 Hand-exercise the resume path: trigger install, observe the download bar at ~40%, press ⌘. to cancel, reopen Install — verify the progress bar starts where it left off.
- [ ] 3.11 Hand-exercise the 200-ignored-range path by modifying the code locally to send `Range: bytes=9999999999-` (invalid); confirm the part file is either truncated (200) or deleted + retried (416).
- [ ] 3.12 Hand-exercise the revision-bump path: fake a resolve to an older revision, start a download, cancel mid-flight, bump the revision, reopen Install — verify the old `.part` is pruned and a fresh download starts.

## 4. Render-safe bundle resolution in `<InstallView />`

- [x] 4.1 Wrap `appBundleFromBinary(chromiumPath)` inside `InstallView` in a `useMemo` that returns a discriminated union `{ ok: true, path } | { ok: false, error }`.
- [x] 4.2 When `ok === false`, render a `<Detail>` whose markdown includes the literal text `"chromiumPath must point to a file inside a .app bundle"` and which exposes Close (⌘.) and Copy Error Details (⌘C) actions.
- [x] 4.3 In the same failure branch, call `showFailureToast(...)` inside a `useEffect` with title `"Invalid Chromium path"` and the thrown error's message.
- [x] 4.4 Ensure the install effect does NOT run when `ok === false` (guard at the top of the `useEffect`).
- [ ] 4.5 Hand-test: set `chromiumPath` preference to `/usr/local/bin/chromium` (no .app), trigger Install, confirm friendly error renders with no crash.

## 5. Swap-failure messaging

- [x] 5.1 In `raycast/src/chromium/installer.ts`, wrap the `fs.rename(sourceApp, appBundlePath)` + `EXDEV` fallback block so that on rejection, the thrown `InstallPathError`'s message begins with `"Chromium bundle at <appBundlePath> is no longer present. "`.
- [x] 5.2 In `<InstallView />`'s failure-state markdown (the `phase === "failed"` branch), detect an `InstallPathError` with that prefix and render the remediation paragraph: `"Your previous Chromium bundle has been removed. Run Install or Update Chromium… again to recover."`
- [ ] 5.3 Hand-test by injecting a temporary `throw new Error("simulated rename failure")` at the swap step and confirming the failure Detail shows the remediation copy.
- [ ] 5.4 Revert the injection.

## 6. Validate and ship

- [x] 6.1 Run `bun run lint` and fix any lint findings.
- [x] 6.2 Run `bun run build` and confirm a clean build.
- [ ] 6.3 Run `bun run dev` and smoke-test the full user flow: fresh install, interrupted install + resume, successful launch, broken-binary launch (liveness-fail).
- [x] 6.4 Update `raycast/CLAUDE.md` if any behaviour notes need to change (e.g., mention the 750 ms liveness window, the resumable download, and the malformed-path guard).
- [ ] 6.5 Stage `raycast/src/...` changes and any dependent `raycast/package.json` regeneration (from the pre-lint hooks) together as required by `.githooks/pre-commit`.
