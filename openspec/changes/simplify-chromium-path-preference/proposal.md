## Why

The `chromiumPath` preference is a full binary path (`~/Applications/Chromium.app/Contents/MacOS/Chromium`), but no call site actually needs the binary path as input — every caller that uses it either spawns it (derivable from the bundle + fixed Contents/MacOS/Chromium layout) or has to walk back to the `.app` bundle via `appBundleFromBinary()`. The current shape requires users to hand-type a 4-segment path whose last two segments are always the same, pretends to support arbitrary layouts, but silently breaks when the `.app` segment is missing (see the `harden-install-and-launch` §4 render-guard that just landed to paper over the crash). Collapsing the preference to a single directory removes an entire class of bad-input failure.

## What Changes

- **BREAKING**: Rename the extension-level `chromiumPath` preference to `chromiumInstallDir`. The new default is `~/Applications` (just the directory that contains `Chromium.app`).
- `getPreferences()` now derives `appBundlePath = <installDir>/Chromium.app` and `binaryPath = <appBundlePath>/Contents/MacOS/Chromium` from the single directory preference. The bundle name is hard-coded to `Chromium.app`.
- Delete `appBundleFromBinary()` from `raycast/src/chromium/launcher.ts` and every call to it. The bundle path is now a pre-computed preference field, so there is no path-parsing step that can throw.
- Delete the render-safe `useMemo` guard added by `harden-install-and-launch` §4 in `InstallView.tsx` (the `AppBundleResolution` discriminated union, the `"Invalid Chromium Path"` `<Detail>` branch, and the accompanying `useEffect` that fires `showFailureToast`). It becomes dead code because the binary path is always well-formed.
- No runtime migration from the old `chromiumPath` key. Existing users see the new default (`~/Applications`) in the preferences pane on first launch of the new version; they re-confirm or edit as needed. The old key remains in Raycast's preference store as dead data.
- Update `raycast/CLAUDE.md`'s Preferences section and the Source Layout caption for `launcher.ts` to reflect the new preference shape.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chromium-installer`: the installer takes `appBundlePath` from preferences directly instead of deriving it via `appBundleFromBinary(chromiumPath)`; the `InstallView` render-safe bundle-resolution requirement added by `harden-install-and-launch` is removed because the preference can no longer produce a malformed bundle path.
- `quick-launch`: the preference input to `launchChromium` and `isChromiumBinaryRunning` is renamed from `chromiumPath` to `binaryPath` (derived from `chromiumInstallDir`); behaviour is otherwise unchanged.

## Impact

- **Code**: `raycast/package.json` (rename preference key + update title/description/default), `raycast/src/preferences.ts` (read new key, compute `installDir`/`appBundlePath`/`binaryPath`), `raycast/src/chromium/launcher.ts` (delete `appBundleFromBinary`, update signatures), `raycast/src/chromium/installer.ts` (drop `appBundleFromBinary` import; consume `appBundlePath` from preferences), `raycast/src/chromium/processes.ts` (rename parameter, otherwise unchanged), `raycast/src/install/InstallView.tsx` (delete render-safe guard branch + imports), and the downstream callers `raycast/src/launch.ts`, `raycast/src/profiles/ProfileList.tsx` (rename `chromiumPath` → `binaryPath` at the call sites).
- **APIs**: `getPreferences()` return type changes — `chromiumPath` is removed; `installDir`, `appBundlePath`, and `binaryPath` are added. Every caller must be updated. `appBundleFromBinary(binaryPath: string): string` is removed. `launchChromium(chromiumPath, …)` and `isChromiumBinaryRunning(chromiumPath)` keep their signatures; only the caller-side variable name changes.
- **Preferences**: extension-level preference `chromiumPath` is removed; `chromiumInstallDir` is added. `raycast-env.d.ts` regenerates via `ray lint`. Existing Raycast preference-store entries for `chromiumPath` become dead data (no code reads them).
- **Dependencies**: none.
- **UX**: users who previously customized `chromiumPath` must re-set `chromiumInstallDir` once after updating. Users on the default see no visible change (the derived binary path matches the old default). The "Invalid Chromium Path" `<Detail>` state disappears entirely.
- **CLI**: `cli/tempchrome.sh` takes its own path argument and does not read the Raycast preference, so it is unaffected.
- **Risk**: Low. The derivation is deterministic; the only user-facing impact is the one-time pref re-set for customized installs. No data loss path.
