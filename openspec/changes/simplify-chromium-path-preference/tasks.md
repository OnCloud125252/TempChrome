## 1. Prerequisites

- [x] 1.1 Confirm `harden-install-and-launch` is archived (its §4 requirement "InstallView renders safely when chromiumPath is malformed" must already exist in `openspec/specs/chromium-installer/spec.md` before this change archives, otherwise the REMOVED delta has nothing to remove).
- [x] 1.2 Confirm no other active change mutates `raycast/src/preferences.ts`, `raycast/src/chromium/launcher.ts`, or `raycast/src/install/InstallView.tsx`; if so, coordinate ordering.

## 2. Rename the preference in `package.json`

- [x] 2.1 In `raycast/package.json`, locate the extension-level `preferences` array (the one outside any command). Change the entry named `chromiumPath` to `chromiumInstallDir`.
- [x] 2.2 Update that entry's `title` to `"Chromium Install Directory"`.
- [x] 2.3 Update its `description` to `"Directory that contains (or will contain) Chromium.app. The installer places Chromium.app here; launches spawn the binary inside it."`.
- [x] 2.4 Update its `default` from `"~/Applications/Chromium.app/Contents/MacOS/Chromium"` to `"~/Applications"`.
- [x] 2.5 Leave `type: "textfield"` and `required: false` unchanged.

## 3. Update `getPreferences()` in `preferences.ts`

- [x] 3.1 In `raycast/src/preferences.ts`, replace the `chromiumPath` read with a `chromiumInstallDir` read.
- [x] 3.2 Compute `const installDir = expandTilde(raw.chromiumInstallDir);`.
- [x] 3.3 Compute `const appBundlePath = path.join(installDir, "Chromium.app");`.
- [x] 3.4 Compute `const binaryPath = path.join(appBundlePath, "Contents", "MacOS", "Chromium");`.
- [x] 3.5 Return `{ installDir, appBundlePath, binaryPath, tempBaseDir: expandTilde(raw.tempBaseDir) }`. Do NOT return `chromiumPath` on the result object.
- [x] 3.6 Update the return-type annotation so consumers get strict autocomplete on the three new fields. If the current code relies on the auto-generated `Preferences` type from `raycast-env.d.ts`, introduce a local `ResolvedPreferences` type that extends `Preferences` with the three derived fields.

## 4. Delete `appBundleFromBinary()` and update callers in `launcher.ts`

- [x] 4.1 In `raycast/src/chromium/launcher.ts`, delete the `appBundleFromBinary` function entirely.
- [x] 4.2 Change `clearQuarantine(chromiumPath: string)` to `clearQuarantine(appBundlePath: string)`. Remove the inner `appBundleFromBinary(chromiumPath)` call; pass `appBundlePath` straight to `execFileAsync("xattr", ["-cr", appBundlePath])`.
- [x] 4.3 Keep `launchChromium`'s first parameter but rename it from `chromiumPath` to `binaryPath` for clarity (internal-only rename; no signature-breaking change beyond the removal of `appBundleFromBinary`).
- [x] 4.4 Keep `chromiumExists`'s parameter; rename internally to `binaryPath`.
- [x] 4.5 Ensure the file no longer references `appBundleFromBinary` or its import anywhere (grep to verify).

## 5. Update `installer.ts`

- [x] 5.1 In `raycast/src/chromium/installer.ts`, remove the `import { appBundleFromBinary } from "./launcher";` line.
- [x] 5.2 Change `RunInstallOptions` to drop `chromiumPath` and add `binaryPath` + `appBundlePath`, both required.
- [x] 5.3 In `runInstall`, replace `const appBundlePath = appBundleFromBinary(chromiumPath);` with `const { binaryPath, appBundlePath } = opts;`.
- [x] 5.4 Update `isChromiumBinaryRunning(chromiumPath)` call sites (there are two — preflight and post-extract preflight) to pass `binaryPath`.

## 6. Update `processes.ts`

- [x] 6.1 Rename the parameter of `isChromiumBinaryRunning` from `chromiumPath` to `binaryPath` (pure rename; behaviour unchanged). The `path.resolve` normalisation stays.

## 7. Update call sites (`launch.ts`, `ProfileList.tsx`, `InstallView.tsx`)

- [x] 7.1 In `raycast/src/launch.ts`, replace every `preferences.chromiumPath` read with `preferences.binaryPath`. Update the `clearQuarantine` call to pass `preferences.appBundlePath`.
- [x] 7.2 In `raycast/src/profiles/ProfileList.tsx`, same replacement: `preferences.chromiumPath` → `preferences.binaryPath`; `clearQuarantine(preferences.chromiumPath)` → `clearQuarantine(preferences.appBundlePath)`.
- [x] 7.3 In `raycast/src/install/InstallView.tsx`, delete the `AppBundleResolution` type alias, the `useMemo` block that computes `appBundleResult`, the `badPathError` state derivation, the `useEffect` that fires `showFailureToast` with title `"Invalid Chromium path"`, and the entire `if (badPathError) { return <Detail … /> }` branch.
- [x] 7.4 In the same file, replace `getPreferences()` destructuring to pull `appBundlePath` and `binaryPath` instead of `chromiumPath`. Pass `binaryPath` + `appBundlePath` to `runInstall` via the new options shape.
- [x] 7.5 In the same file, remove any now-unused imports (`appBundleFromBinary`, `useMemo` if it was only used by the deleted block).

## 8. Sweep for leftover references

- [x] 8.1 Grep `raycast/src/**` for `chromiumPath` and confirm the only remaining matches are either in comments (remove them) or nonexistent. Target: zero matches.
- [x] 8.2 Grep `raycast/src/**` for `appBundleFromBinary` and confirm zero matches.
- [x] 8.3 Grep `raycast/**/*.md` (docs) for `chromiumPath`; update `raycast/CLAUDE.md`'s Preferences section and the `launcher.ts` source-layout caption.

## 9. Validate and ship

- [x] 9.1 Run `bun run lint`. The `ray lint` step regenerates `raycast-env.d.ts` so the new `chromiumInstallDir` type flows through.
- [x] 9.2 Run `bun run build` and confirm a clean TypeScript compile.
- [ ] 9.3 Run `bun run dev` and smoke-test: (a) launch on the default install (no custom pref), (b) change `chromiumInstallDir` to a non-existent dir, trigger launch, confirm the existing "Chromium not found" toast fires (not a render crash), (c) trigger Install with the default pref, confirm the bundle lands at `~/Applications/Chromium.app`.
- [x] 9.4 Update `raycast/CLAUDE.md`: replace the "Chromium Path" bullet under **Preferences** with a "Chromium Install Directory" bullet describing the new shape; update the `launcher.ts` source-layout line to remove `appBundleFromBinary` from its enumerated exports; remove the §4 mention from the "Launch and install hardening" section (the render guard no longer exists).
- [x] 9.5 Add a one-line entry to any release-notes / changelog surface noting the preference rename (text: "`chromiumPath` preference renamed to `chromiumInstallDir`; users who customised the old path must re-set the new preference once").
- [ ] 9.6 Stage `raycast/src/...`, `raycast/package.json`, and `raycast/CLAUDE.md` together per `.githooks/pre-commit`.
