## 1. Preferences: expand `~` and move the default Chromium path

- [x] 1.1 In `raycast/package.json`, change the `chromiumPath` extension preference `default` from `/Applications/Chromium.app/Contents/MacOS/Chromium` to `~/Applications/Chromium.app/Contents/MacOS/Chromium`.
- [x] 1.2 In `raycast/src/preferences.ts`, add a local helper `expandTilde(p: string): string` that, if `p === "~"` returns `os.homedir()`, if `p.startsWith("~/")` returns `path.join(os.homedir(), p.slice(2))`, otherwise returns `p` unchanged.
- [x] 1.3 Apply `expandTilde` to both `chromiumPath` and `tempBaseDir` inside `getPreferences()` before returning.
- [x] 1.4 Run `bun run lint` in `raycast/` and resolve any findings introduced by the change.

## 2. Process detection: detect a Chromium running from a specific binary

- [x] 2.1 In `raycast/src/chromium/processes.ts`, add `async function isChromiumBinaryRunning(chromiumPath: string): Promise<boolean>` that runs `ps -axo pid,comm,args` (or reuses the existing `getChromiumProcessArgs`-style approach) and returns `true` if any row's executable path equals `chromiumPath` (resolved via `path.resolve`).
- [x] 2.2 Keep the existing `isProfileInUse(profileDir)` helper untouched. Both helpers can live side-by-side.
- [x] 2.3 Add a short JSDoc only if the distinction between the two helpers is non-obvious to a reader; default to no comment.

## 3. Pure installer module (no Raycast UI)

- [x] 3.1 Create `raycast/src/chromium/installer.ts` exporting `runInstall(opts: RunInstallOptions): Promise<{ revision: string }>`.
- [x] 3.2 Define the exported types: `RunInstallOptions = { chromiumPath: string; signal: AbortSignal; onProgress: (p: InstallProgress) => void }` and the `InstallProgress` union per `design.md`.
- [x] 3.3 Define and export the typed error classes: `ChromiumRunningError`, `NetworkError`, `ExtractionError`, `InstallPathError`, `AbortedError`.
- [x] 3.4 Implement the preflight step per `design.md §Pipeline 1`: derive `appBundlePath` via `appBundleFromBinary(chromiumPath)` (reuse `src/chromium/launcher.ts`), ensure parent dir exists via `fs.mkdir({ recursive: true })`, call `isChromiumBinaryRunning(chromiumPath)` and throw `ChromiumRunningError` if true.
- [x] 3.5 Implement revision resolution: `fetch("https://storage.googleapis.com/chromium-browser-snapshots/<platform>/LAST_CHANGE", { signal })`, where `platform = process.arch === "arm64" ? "Mac_Arm" : "Mac"`. Emit `{ stage: "resolve-revision" }` on entry. Throw `NetworkError` on non-2xx.
- [x] 3.6 Implement streaming download: `fetch(<snapshot-zip-url>, { signal })`, stream body via `getReader()` into `fs.createWriteStream(<tmpZip>.part)`, track `bytesDownloaded`, read `content-length` header as `bytesTotal` (or `null` if missing), emit `{ stage: "download", ... }` on each chunk.
- [x] 3.7 After the loop, `await stream.end()` (wrap in a promise around the `finish` event), then `fs.rename("<tmpZip>.part", "<tmpZip>")`. Ensures the final name never refers to a partial file.
- [x] 3.8 Implement extraction via `child_process.spawn("/usr/bin/unzip", ["-oq", zipPath, "-d", extractDir], { signal })`. Await close. If exit code ≠ 0 or `signal.aborted`, throw `ExtractionError` or `AbortedError` accordingly.
- [x] 3.9 Verify `<extractDir>/chrome-mac/Chromium.app` exists and is a directory. Throw `ExtractionError("Chromium.app not in archive")` otherwise.
- [x] 3.10 Implement the swap step: re-check `isChromiumBinaryRunning(chromiumPath)` and throw `ChromiumRunningError` if true. `fs.rm(appBundlePath, { recursive: true, force: true })`. Try `fs.rename(sourceApp, appBundlePath)`; on `EXDEV`, fall back to `fs.cp(sourceApp, appBundlePath, { recursive: true, force: true })` then `fs.rm(sourceApp, { recursive: true, force: true })`.
- [x] 3.11 Clear quarantine: `spawn("/usr/bin/xattr", ["-cr", appBundlePath])`. Await close. Non-fatal on failure (log via `console.error` and continue; emit a `{ stage: "xattr" }` event first).
- [x] 3.12 Cleanup: `fs.rm(extractDir, { recursive: true, force: true })` and `fs.rm(zipPath, { force: true })`. Emit `{ stage: "done", revision }`.
- [x] 3.13 Install an `AbortSignal` listener at the top of the function that, when fired, kills any active subprocess reference and causes the pipeline to throw `AbortedError` at the next `await` boundary. Use `signal.throwIfAborted()` at the start of each stage as an additional guard.
- [x] 3.14 Ensure `fs.rm(zipPath, { force: true })` also runs in a `finally` block on the cleanup path, so cancelled or failed runs do not leave temp files behind.

## 4. InstallView (Raycast UI)

- [x] 4.1 Create `raycast/src/install/InstallView.tsx` exporting a default function component `<InstallView />`. No props — it reads `chromiumPath` from `getPreferences()`.
- [x] 4.2 Use a single `useEffect` to instantiate an `AbortController` and call `runInstall({ chromiumPath, signal, onProgress })` on mount. Cleanup aborts the controller and awaits nothing (fire-and-forget cleanup is fine because `runInstall` always reaches its `finally`).
- [x] 4.3 Hold current progress in `useState<InstallProgress | null>(null)` and view phase in `useState<"running" | "done" | "failed" | "cancelled">("running")`.
- [x] 4.4 Throttle progress re-renders: wrap `onProgress` in a function that calls `setProgress` only when the stage changes OR `bytesDownloaded` has advanced ≥ 1 % OR ≥ 250 ms have passed since last update. Track last-update timestamp in a `useRef`.
- [x] 4.5 Render a `<Detail markdown={...} navigationTitle={...} metadata={...}>` per the rendering spec in `design.md §UI rendering`. Keep the markdown body function pure (given a progress state, it returns the same string).
- [x] 4.6 Wire up the initial `showToast` animated toast on mount, the success toast on `done`, and `showFailureToast(error, { title: ... })` on failure. Use the error's constructor name to pick a title (`ChromiumRunningError → "Chromium is running"`, `NetworkError → "Download failed"`, etc.).
- [x] 4.7 Implement the `<ActionPanel>`: **Cancel** (`⌘.`, `Icon.Stop`) while `phase === "running"`; **Copy Error Details** and **Close** (`⌘W`, `Icon.XMarkCircle`) in terminal phases. Cancel calls `abortController.abort()` and transitions phase to `"cancelled"`. Close calls `popToRoot()`.
- [x] 4.8 Every action declares `shortcut={...}` per the repo UX policy. Every view sets `navigationTitle`.

## 5. Wire into Tempchrome.tsx

- [x] 5.1 In `raycast/src/Tempchrome.tsx`, remove the `handleInstall` function and its `osascript` calls. Remove the `execFile` / `promisify` imports if they are no longer used elsewhere in the file (leave them only if `handleLaunch` still uses them — it does not today).
- [x] 5.2 Change the "Install or Update Chromium…" `List.Item`:
  - `subtitle` → `"Download and install the latest Chromium snapshot"`.
  - Replace `<Action title="Open Terminal" onAction={handleInstall} />` with `<Action.Push title="Install" icon={Icon.Download} shortcut={{ modifiers: ["cmd"], key: "i" }} target={<InstallView />} />`.
  - Keep the `accessories={[{ tag: "⌘I" }]}` entry.
- [x] 5.3 Import `InstallView` from `./install/InstallView`.
- [x] 5.4 Run `bun run lint` in `raycast/` and fix any issues.

## 6. Remove the `--install` branch from the shell CLI

- [x] 6.1 In `cli/tempchrome.sh`, delete the entire `install_chromium()` function (lines ~55–118 in the current file).
- [x] 6.2 Delete the `detect_arch()` function (only used by `install_chromium`).
- [x] 6.3 Delete the `SNAPSHOT_BASE_URL` constant.
- [x] 6.4 Delete the `--install|--update` case branch inside the argument parser.
- [x] 6.5 In `usage()`, remove the `--install, --update` OPTIONS line and any `--install` example in the EXAMPLES block.
- [x] 6.6 Reword the "Chromium not found at <path>" error block: replace the `tempchrome --install` hint with `"Install Chromium via the Raycast command 'Install or Update Chromium…' in the TempChrome extension."` Keep the Homebrew-deprecated warning line unchanged.
- [x] 6.7 Run `shellcheck cli/tempchrome.sh` — must pass with no new findings.
- [x] 6.8 Manually verify `cli/tempchrome.sh --help` no longer mentions `--install` or `--update`.

## 7. Documentation

- [x] 7.1 Rewrite the "Install" / "Getting Started" section in the root `README.md` to describe the Raycast flow only. Remove any shell snippet that invokes `tempchrome --install`.
- [x] 7.2 Add a one-paragraph note that the default install target is now `~/Applications/Chromium.app` and that users who prefer `/Applications/Chromium.app` should update the **Chromium Path** extension preference to point there.
- [x] 7.3 In `raycast/CLAUDE.md`, update the install paragraph ("The Install action delegates to the `tempchrome` CLI via Terminal.app — install the CLI first …") to describe the native installer and the new default path.
- [x] 7.4 In `CLAUDE.md` (project root), review the Important Notes section — update any lines that imply `/Applications/Chromium.app` is the canonical install path.

## 8. Manual validation

- [ ] 8.1 With `/Applications/Chromium.app` not present and `~/Applications/Chromium.app` not present, trigger the Raycast "Install or Update Chromium…" command. Confirm: `<Detail>` renders, progress bar advances, success toast fires, `~/Applications/Chromium.app/Contents/MacOS/Chromium` exists afterwards.
- [ ] 8.2 Launch TempChrome once after the install to confirm the launcher finds Chromium at the new default path and opens a temp profile without errors.
- [ ] 8.3 Trigger the installer a second time while a TempChrome-launched Chromium window is still open. Confirm: preflight fails, failure toast title is `"Chromium is running"`, no files are touched.
- [ ] 8.4 Trigger the installer and press `⌘.` mid-download. Confirm: failure toast title is `"Install cancelled"`, `~/Applications/Chromium.app` is unchanged (either still the old bundle or still absent), no `.part` file remains in `/tmp/`.
- [ ] 8.5 Trigger the installer with airplane mode on. Confirm: failure toast title is `"Download failed"` and contains a useful error message.
- [x] 8.6 Run `bun run lint` and `bun run build` in `raycast/`. Both pass.
- [x] 8.7 Run `shellcheck cli/tempchrome.sh`. Passes with no new findings.
