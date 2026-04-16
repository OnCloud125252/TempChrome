## 1. Project Scaffolding

- [x] 1.1 Create `raycast/package.json` with these fields: `name: "tempchrome"`, `title: "TempChrome"`, `description: "Launch Chromium with temporary, isolated profiles"`, `author: "alex_liao_oncloud"`, `license: "MIT"`, `categories: ["Applications", "Developer Tools"]`, `icon: "icon.png"`, scripts `{ "build": "ray build -e dist -o dist", "dev": "ray develop", "lint": "ray lint", "fix-lint": "ray lint --fix", "publish": "ray publish" }`, dependencies `{ "@raycast/api": "^1.80.0", "@raycast/utils": "^1.17.0" }`, devDependencies `{ "@raycast/eslint-config": "^1.0.11", "@types/node": "22.13.10", "@types/react": "19.0.10", "eslint": "^8.57.0", "prettier": "^3.3.3", "typescript": "^5.4.5" }` (the `@types/*` versions are pinned to match `@raycast/api`'s peer dependencies — React 19's `ReactNode` widening otherwise breaks the type-check during `ray build`). Leave the `commands` and `preferences` arrays for tasks 1.2 and 1.3.

- [x] 1.2 Add a `commands` array to `raycast/package.json` with exactly these two entries:
  - `{ "name": "launch", "title": "Launch TempChrome", "subtitle": "TempChrome", "description": "Create a temporary profile and launch Chromium instantly", "mode": "no-view" }`
  - `{ "name": "tempchrome", "title": "TempChrome", "subtitle": "TempChrome", "description": "Launch, manage profiles, or install Chromium", "mode": "view" }`

- [x] 1.3 Add a `preferences` array to `raycast/package.json` with exactly these two entries:
  - `{ "name": "chromiumPath", "type": "textfield", "required": false, "title": "Chromium Path", "description": "Absolute path to the Chromium binary", "default": "/Applications/Chromium.app/Contents/MacOS/Chromium" }`
  - `{ "name": "tempBaseDir", "type": "textfield", "required": false, "title": "Temp Profile Base Directory", "description": "Directory where temporary profiles are created", "default": "/tmp/tempchrome_profile" }`

- [x] 1.4 Create `raycast/tsconfig.json` with content `{ "extends": "@raycast/tsconfig/base.json", "compilerOptions": { "jsx": "react-jsx", "strict": true, "target": "ES2020", "lib": ["ES2020", "DOM"], "esModuleInterop": true, "moduleResolution": "node", "skipLibCheck": true }, "include": ["src/**/*"] }`. If `@raycast/tsconfig` is unavailable, inline equivalent compiler options.

- [x] 1.5 Create `raycast/.eslintrc.json` with content `{ "extends": ["@raycast"] }`.

- [x] 1.6 Create `raycast/.prettierrc` with content `{ "semi": true, "singleQuote": false, "printWidth": 100, "tabWidth": 2, "trailingComma": "all" }`.

- [x] 1.7 Create `raycast/.gitignore` containing `node_modules/`, `dist/`, `.DS_Store`, `.raycast/`, each on its own line.

- [x] 1.8 Create `raycast/assets/` directory. Add a placeholder `icon.png` (512×512). Document at the top of `raycast/README.md` that the final icon should be an indigo (`#4F46E5`) background with a white globe+stopwatch glyph. A solid-color PNG is acceptable until the final art is ready.

- [x] 1.9 From `raycast/`, run `bun install`. Verify `raycast/node_modules/@raycast/api/package.json` exists and that `bun run lint` exits 0 on the empty `src/` (it may warn about no source files; no errors).

## 2. Shared Modules

- [x] 2.1 Create `raycast/src/constants.ts` exporting these named constants exactly:
  - `export const BASE_CHROMIUM_ARGS = ["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window"] as const;`
  - `export const GOOGLE_ENV = { GOOGLE_API_KEY: "AIzaSyCkfPOPZXDKNn8hhgu3JrA62wIgC93d44k", GOOGLE_DEFAULT_CLIENT_ID: "811574891467.apps.googleusercontent.com", GOOGLE_DEFAULT_CLIENT_SECRET: "kdloedMFGdGla2P1zacGjAQh" } as const;`
  - `export const AUTO_CLEANUP_REGISTRY_KEY = "tempchrome.auto-cleanup-registry";`
  - `export const ID_CHARSET = "abcdefghijklmnopqrstuvwxyz0123456789";`
  - `export const ID_LENGTH = 10;`
  - `export const MAX_ID_ATTEMPTS = 100;`

- [x] 2.2 Create `raycast/src/preferences.ts` exporting:
  - `export type Preferences = { chromiumPath: string; tempBaseDir: string };`
  - `export function getPreferences(): Preferences` — returns `getPreferenceValues<Preferences>()` imported from `@raycast/api`.

- [x] 2.3 Create `raycast/src/chromium.ts` exporting the following async helpers:
  - `appBundleFromBinary(binaryPath: string): string` — returns the `.app` directory by splitting `binaryPath` on `/` and walking up until it finds a segment ending in `.app`, then reconstructing. Example: `/Applications/Chromium.app/Contents/MacOS/Chromium` → `/Applications/Chromium.app`. Throws if no `.app` segment is found.
  - `async chromiumExists(chromiumPath: string): Promise<boolean>` — uses `fs.promises.access(chromiumPath, fs.constants.X_OK)` and returns `true` on success, `false` on any error.
  - `async createTempProfile(tempBaseDir: string): Promise<string>` — ensures `tempBaseDir` exists with mode `0o700`; loops up to `MAX_ID_ATTEMPTS` times generating a random 10-char ID from `ID_CHARSET` (use `crypto.randomInt(0, ID_CHARSET.length)` per character), attempting `fs.promises.mkdir(path.join(tempBaseDir, id), { mode: 0o700 })`; catches `EEXIST` and retries; re-throws any other error; throws `new Error("Failed to create unique profile directory after " + MAX_ID_ATTEMPTS + " attempts")` if the loop exhausts.
  - `async clearQuarantine(chromiumPath: string): Promise<void>` — derives the app bundle, then calls `execFile("xattr", ["-cr", appBundle])` (promisified via `util.promisify`). Swallows any error (logs to console only).
  - `launchChromium(chromiumPath: string, profileDir: string, extraArgs: string[]): void` — builds `args = [...BASE_CHROMIUM_ARGS, \`--user-data-dir=${profileDir}\`, ...extraArgs]`, builds `env = { ...process.env, ...GOOGLE_ENV }`, calls `spawn(chromiumPath, args, { detached: true, stdio: "ignore", env })`, then calls `child.unref()` immediately. No return value.

- [x] 2.4 Create `raycast/src/process-check.ts` exporting:
  - `async getChromiumProcessArgs(): Promise<string[]>` — runs `execFile("ps", ["-Ao", "args="])` via promisified exec; returns `stdout.split("\n").filter(line => line.trim().length > 0)`. Returns `[]` on execFile error (with a `console.error` log).
  - `isProfileInUse(profilePath: string, psLines: string[]): boolean` — returns `psLines.some(line => line.includes(\`--user-data-dir=${profilePath}\`))`.

- [x] 2.5 Create `raycast/src/trash.ts` exporting:
  - Module-local `let trashMissingToastShown = false;`
  - `async trashPath(path: string): Promise<void>` — tries `execFile("trash", [path])`; catches errors; if `error.code === "ENOENT"` (binary missing), falls back to `fs.promises.rm(path, { recursive: true, force: true })` and, if `!trashMissingToastShown`, calls `showToast({ style: Toast.Style.Failure, title: "'trash' CLI not found", message: "Deleting permanently. Install with `brew install trash` for recoverable deletes." })` and sets `trashMissingToastShown = true`. Re-throws any non-`ENOENT` error.

- [x] 2.6 Create `raycast/src/auto-cleanup.ts` exporting:
  - `export type Registry = Record<string, number>;`
  - `async readRegistry(): Promise<Registry>` — reads `LocalStorage.getItem(AUTO_CLEANUP_REGISTRY_KEY)`, `JSON.parse` with a `try/catch`, returns `{}` on null/parse error.
  - `async writeRegistry(registry: Registry): Promise<void>` — `LocalStorage.setItem(AUTO_CLEANUP_REGISTRY_KEY, JSON.stringify(registry))`.
  - `async markForAutoCleanup(profilePath: string): Promise<void>` — `read → set registry[profilePath] = Date.now() → write`.
  - `async unmarkAutoCleanup(profilePath: string): Promise<void>` — `read → delete registry[profilePath] → write`.
  - `async sweepStaleProfiles(): Promise<string[]>` — reads registry; if empty, return `[]`; fetches `psLines = await getChromiumProcessArgs()`; computes `stalePaths = Object.keys(registry).filter(p => !isProfileInUse(p, psLines))`; for each stale path `p`, wraps `trashPath(p)` in try/catch (log errors, continue); on success, `delete registry[p]`; writes registry; returns the array of paths that were successfully trashed.
  - `runSweepFireAndForget(): void` — calls `sweepStaleProfiles().catch(err => console.error("sweep failed", err))`. Returns immediately (no `await`).

- [x] 2.7 Create `raycast/src/profiles.ts` exporting:
  - `export type ProfileInfo = { id: string; path: string; size: number; createdAt: Date; inUse: boolean; autoCleanup: boolean };`
  - `async computeDirectorySize(dir: string): Promise<number>` — recursive; `readdir` with `{ withFileTypes: true }`; for each entry, if file → add `stat.size`, if directory → recurse. Returns `0` on ENOENT.
  - `async listProfiles(tempBaseDir: string): Promise<ProfileInfo[]>` — tries `fs.promises.readdir(tempBaseDir, { withFileTypes: true })`; on ENOENT, returns `[]`; filters for `dirent.isDirectory()`; fetches `psLines` and `registry` once; for each subdir, produces a `ProfileInfo` by calling `fs.stat` for `birthtime`, `computeDirectorySize`, `isProfileInUse`, and `profilePath in registry`; sorts by `createdAt` descending (`b.createdAt.getTime() - a.createdAt.getTime()`); returns the array.
  - `formatBytes(bytes: number): string` — returns humanized string: `< 1024` → `"N B"`; `< 1024²` → `"N.N KB"`; `< 1024³` → `"N.N MB"`; else `"N.N GB"`. Use `toFixed(1)` for fractional units.

## 3. Quick Launch Command (no-view)

- [x] 3.1 Create `raycast/src/launch.ts` exporting:
  - `export async function quickLaunch(): Promise<void>` — the reusable quick-launch logic. Gets preferences; verifies `chromiumExists`; on miss calls `showFailureToast(new Error("not found"), { title: "Chromium not found" })` with message `"Run 'Install or Update Chromium' from the TempChrome command to install it."` and returns; calls `createTempProfile`, `clearQuarantine` (awaited), `launchChromium` (not awaited — synchronous), `showHUD("Launched TempChrome")`, and `runSweepFireAndForget()`. Never throws (wrap in try/catch at the boundary; log errors via `showFailureToast` if anything unexpected escapes).
  - `export default async function Command(): Promise<void>` — calls `await quickLaunch()`.

- [ ] 3.2 Manual verification: run `cd raycast && bun run dev`. In Raycast, trigger "Launch TempChrome". Verify: (a) HUD appears, (b) a new directory appears under `/tmp/tempchrome_profile/` with a 10-character lowercase-alphanumeric name, (c) Chromium opens with a fresh profile.

## 4. TempChrome Root Command (view, List)

- [x] 4.1 Create `raycast/src/tempchrome.tsx` default-exporting a React functional component `Command()` that returns `<List>` containing four `<List.Item>` elements in this order:
  1. `{ icon: Icon.Rocket, title: "Launch Now", actions: <ActionPanel><Action title="Launch" onAction={handleLaunch} /></ActionPanel> }`
  2. `{ icon: Icon.Gear, title: "Launch with Options…", actions: <ActionPanel><Action.Push title="Open" target={<LaunchOptionsForm />} /></ActionPanel> }`
  3. `{ icon: Icon.Folder, title: "Manage Temp Profiles…", actions: <ActionPanel><Action.Push title="Open" target={<ProfileList />} /></ActionPanel> }`
  4. `{ icon: Icon.Download, title: "Install or Update Chromium…", actions: <ActionPanel><Action title="Open Terminal" onAction={handleInstall} /></ActionPanel> }`

- [x] 4.2 Define `handleLaunch` in `tempchrome.tsx` — imports and calls `quickLaunch()` from `./launch`. After `await quickLaunch()`, close the Raycast window via `popToRoot({ clearSearchBar: true })` so the user lands back on root.

- [x] 4.3 Define `handleInstall` in `tempchrome.tsx` per task 7.1 (implementation lives in this file; referenced from task section 7 for clarity).

- [ ] 4.4 Manual verification: in `ray develop`, trigger "TempChrome" (the view command). Verify: all four list items render in order with correct icons; selecting "Launch Now" opens Chromium; "Launch with Options…" pushes a Form; "Manage Temp Profiles…" pushes a List; "Install or Update Chromium…" opens Terminal.app.

## 5. Launch with Options Sub-view

- [x] 5.1 Create `raycast/src/LaunchOptionsForm.tsx` default-exporting a React component that renders a `<Form>` with the eight elements specified in `specs/launch-options/spec.md` → "Form renders configurable launch fields in a fixed order". Field IDs: `browsingMode`, `disableWebSecurity`, `disableExtensions`, `autoCleanup`, `customArgs`. Use `Form.Dropdown` with two `Form.Dropdown.Item` entries (values `"normal"` and `"incognito"`). Place `Form.Separator` at positions 2, 5, and 7. The submit action SHALL be `<Action.SubmitForm title="Launch" onSubmit={handleSubmit} />` inside `<Form.Actions>`.

- [x] 5.2 Implement `handleSubmit(values: FormValues)` inside `LaunchOptionsForm.tsx`:
  - `FormValues` type: `{ browsingMode: "normal" | "incognito"; disableWebSecurity: boolean; disableExtensions: boolean; autoCleanup: boolean; customArgs: string }`.
  - Build `extraArgs: string[]` by concatenating these in order: `(values.browsingMode === "incognito" ? ["--incognito"] : [])`, `(values.disableWebSecurity ? ["--disable-web-security"] : [])`, `(values.disableExtensions ? ["--disable-extensions"] : [])`, `values.customArgs.trim().split(/\s+/).filter(token => token.length > 0)`.
  - Get preferences; verify `chromiumExists`; on miss show failure toast and return (do not `pop`).
  - Call `createTempProfile` → `await clearQuarantine` → `launchChromium(prefs.chromiumPath, profileDir, extraArgs)`.
  - If `values.autoCleanup`, `await markForAutoCleanup(profileDir)`.
  - Call `showHUD(values.autoCleanup ? "Launched (auto-cleanup enabled)" : "Launched")`.
  - Call `runSweepFireAndForget()`.
  - Call `useNavigation().pop()` to return to the TempChrome List.
  - Wrap the whole handler in try/catch; on thrown error, show `showFailureToast(err, { title: "Launch failed" })` and do not `pop`.

- [ ] 5.3 Manual verification: open "Launch with Options…". Verify: (a) all fields render with correct defaults (`browsingMode`=Normal, both security/extension checkboxes unchecked, `autoCleanup` checked, `customArgs` empty); (b) submitting with `browsingMode`=Incognito, `disableWebSecurity`=true, `customArgs`=`--window-size=800,600` opens Chromium and `ps -Ao args=` shows all three flags; (c) with `autoCleanup`=true, `LocalStorage` under key `tempchrome.auto-cleanup-registry` contains the new profile path (inspect via a temporary debug `List.Item` or `console.log` during dev).

## 6. Manage Profiles Sub-view

- [x] 6.1 Create `raycast/src/ProfileList.tsx` default-exporting a React component that:
  - Uses `usePromise` from `@raycast/utils` with an async fetcher calling `listProfiles(prefs.tempBaseDir)`. Destructure `{ data, isLoading, revalidate }`.
  - Renders `<List isLoading={isLoading}>` with one `<List.Item>` per entry in `data`, keyed by `profile.id`.
  - Each `List.Item` has: `title: profile.id`, `subtitle: formatBytes(profile.size)`, `accessories: [...(profile.autoCleanup ? [{ tag: { value: "Auto-cleanup", color: Color.Blue } }] : []), profile.inUse ? { tag: { value: "In use", color: Color.Green }, icon: Icon.CircleFilled } : { tag: { value: "Idle", color: Color.SecondaryText } }, { date: profile.createdAt }]`.
  - When `!isLoading && data.length === 0`, render `<List.EmptyView title="No temporary profiles found" description="Launch TempChrome to create one." actions={<ActionPanel><Action title="Launch TempChrome" onAction={async () => { await quickLaunch(); revalidate(); }} /></ActionPanel>} />`.

- [x] 6.2 Add per-item `<ActionPanel>` containing (in this order): `<Action title="Launch with This Profile" icon={Icon.Rocket} onAction={() => handleRelaunch(profile)} />`, `<Action.ShowInFinder path={profile.path} />`, `<Action.CopyToClipboard title="Copy Path" content={profile.path} />`, `<Action title="Delete Profile" icon={Icon.Trash} style={Action.Style.Destructive} shortcut={{ modifiers: ["ctrl"], key: "x" }} onAction={() => handleDelete(profile)} />`, `<Action title="Delete All Idle Profiles" icon={Icon.Trash} style={Action.Style.Destructive} shortcut={{ modifiers: ["cmd", "shift"], key: "backspace" }} onAction={() => handleDeleteAll(data)} />`, `<Action title="Clean Up Stale Profiles" icon={Icon.Hammer} onAction={handleCleanupStale} />`.

- [x] 6.3 Implement `handleRelaunch(profile: ProfileInfo)`:
  - Verify `chromiumExists`; on miss, failure toast with title `"Chromium not found"` and return.
  - `await clearQuarantine(prefs.chromiumPath)`.
  - `launchChromium(prefs.chromiumPath, profile.path, [])`.
  - `showHUD("Launched with profile " + profile.id)`.

- [x] 6.4 Implement `handleDelete(profile: ProfileInfo)`:
  - Build `title`, `message`, `primaryAction` based on `profile.inUse`:
    - Idle: `title: "Delete profile?"`, `message: profile.id + " (" + formatBytes(profile.size) + ") will be moved to Trash."`, primary `"Delete"`.
    - In-use: `title: "Delete profile in use?"`, `message: profile.id + " (" + formatBytes(profile.size) + ") is currently in use by Chromium. Deleting it may corrupt the running session. Continue?"`, primary `"Delete Anyway"`.
  - Call `confirmAlert` with the derived params and `primaryAction.style = Alert.ActionStyle.Destructive`. Returns `true` on confirm.
  - On confirm: `await trashPath(profile.path)`; `await unmarkAutoCleanup(profile.path)`; `revalidate()`.

- [x] 6.5 Implement `handleDeleteAll(profiles: ProfileInfo[])`:
  - Compute `idle = profiles.filter(p => !p.inUse)`, `inUse = profiles.length - idle.length`, `totalSize = idle.reduce((s, p) => s + p.size, 0)`.
  - If `idle.length === 0`: `showToast({ style: Toast.Style.Failure, title: "Nothing to delete", message: profiles.length === 0 ? "No profiles found." : "All profiles are in use." })` and return.
  - Call `confirmAlert({ title: "Delete " + idle.length + " idle profile(s)?", message: "Total " + formatBytes(totalSize) + " will be moved to Trash." + (inUse > 0 ? " " + inUse + " in-use profile(s) will be skipped." : ""), primaryAction: { title: "Delete " + idle.length, style: Alert.ActionStyle.Destructive } })`.
  - On confirm: `await Promise.all(idle.map(p => trashPath(p.path)))`; read registry, delete each idle path from it, write; `showToast({ style: Toast.Style.Success, title: "Deleted " + idle.length + " profile(s)", ...(inUse > 0 ? { message: inUse + " skipped (in use)" } : {}) })`; `revalidate()`.

- [x] 6.6 Implement `handleCleanupStale`:
  - `const cleaned = await sweepStaleProfiles();`
  - If `cleaned.length === 0`, `showToast({ style: Toast.Style.Failure, title: "Nothing to clean up", message: "No stale auto-cleanup profiles found." })`.
  - Else, `showToast({ style: Toast.Style.Success, title: "Cleaned up " + cleaned.length + " stale profile(s)" })`.
  - `revalidate()`.

- [ ] 6.7 Manual verification: open "Manage Temp Profiles…". Verify: (a) existing profiles appear with correct size, date, idle/in-use status, and auto-cleanup badge where applicable; (b) "Launch with This Profile" relaunches Chromium with that profile (confirm via `ps -Ao args=`); (c) "Delete Profile" on idle shows standard confirmation and moves to Trash; (d) "Delete Profile" on in-use shows stronger "Delete Anyway" confirmation; (e) "Delete All Idle Profiles" confirms with count+size and deletes only idle; (f) "Clean Up Stale Profiles" trashes registry entries with no running process; (g) empty state renders `<List.EmptyView>` with the "Launch TempChrome" action.

## 7. Install Action

- [x] 7.1 In `raycast/src/tempchrome.tsx`, implement `async function handleInstall(): Promise<void>`:
  - Build two AppleScript strings exactly: `const s1 = 'tell application "Terminal" to activate';` and `const s2 = 'tell application "Terminal" to do script "tempchrome --install"';`.
  - Wrap in try/catch:
    - Try: `await execFilePromise("osascript", ["-e", s1, "-e", s2]);` then `showHUD("Opening Terminal to install Chromium…")`.
    - Catch: `showFailureToast(err, { title: "Could not open Terminal" })`.
  - Do NOT pre-check PATH for `tempchrome`. Do NOT fetch anything. Do NOT touch `/Applications/`.

- [ ] 7.2 Manual verification: trigger "Install or Update Chromium…" from the TempChrome List. Verify: (a) Terminal.app activates in the foreground; (b) a new Terminal window or tab opens with `tempchrome --install` at the prompt (actually running if the CLI is on PATH); (c) Raycast shows HUD `"Opening Terminal to install Chromium…"`; (d) disabling Terminal automation in System Settings → Privacy → Automation, then retrying, shows a failure toast `"Could not open Terminal"`.

## 8. Testing and Validation

- [x] 8.1 From `raycast/`, run `bun run lint`. Fix all errors until the command exits 0. Warnings may be addressed later.

- [x] 8.2 From `raycast/`, run `bun run build`. Verify the command exits 0 and produces a `raycast/dist/` directory containing the compiled commands.

- [ ] 8.3 End-to-end test: Quick Launch — in Raycast, trigger "Launch TempChrome". Confirm: HUD `"Launched TempChrome"`; new 10-char directory appears in `/tmp/tempchrome_profile/`; Chromium opens with a fresh profile.

- [ ] 8.4 End-to-end test: Launch with Options — open "Launch with Options…", submit with `browsingMode=Incognito`, `disableWebSecurity=true`, `disableExtensions=false`, `autoCleanup=true`, `customArgs="--window-size=1920,1080"`. Confirm via `ps -Ao args=` that Chromium is running with `--incognito --disable-web-security --window-size=1920,1080` and the correct `--user-data-dir`. Confirm the profile path is in the auto-cleanup registry (inspect via `defaults read <bundle-id>` or a temporary dev-only debug action).

- [ ] 8.5 End-to-end test: Opportunistic sweep — with the Launch-with-Options profile still marked for auto-cleanup, close Chromium completely (quit, not just close window). Then trigger "Launch TempChrome" again. Verify: the old profile directory is trashed within a few seconds (check `/tmp/tempchrome_profile/` — it should no longer contain the old directory); the registry no longer contains the old path.

- [ ] 8.6 End-to-end test: Manage Profiles — open "Manage Temp Profiles…". Create several profiles (some auto-cleanup, some not; some in-use, some idle). Verify the list renders correctly (size, date, idle/in-use tag, auto-cleanup badge). Run each action at least once: Show in Finder, Copy Path (HUD "Path copied"), Launch with This Profile, Delete Profile (idle), Delete Profile (in-use — verify stronger confirmation text), Delete All Idle Profiles, Clean Up Stale Profiles.

- [ ] 8.7 End-to-end test: Install — with `tempchrome` on PATH, trigger "Install or Update Chromium…". Verify Terminal opens with `tempchrome --install` executing. Then rename/remove the CLI temporarily and retry — verify Terminal shows `zsh: command not found: tempchrome` and the Raycast extension still shows the success HUD.

- [ ] 8.8 Error-path test: remove `/Applications/Chromium.app` (or point `chromiumPath` preference at a non-existent path). Trigger "Launch TempChrome" and "Launch with Options…" — verify both show the "Chromium not found" failure toast and do not create a temp directory.

- [ ] 8.9 Error-path test: with `trash` CLI uninstalled (`brew uninstall trash` in a test environment), trigger "Delete Profile". Verify the one-time `"'trash' CLI not found"` toast appears and the profile is deleted via `fs.rm` fallback. Trigger again and verify the toast does NOT reappear.
