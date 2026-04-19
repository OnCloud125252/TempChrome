## Why

The install and launch flows hit edge cases that silently degrade the user experience or, in the worst case, leave the user with no working Chromium. A code walkthrough surfaced four concrete gaps: (1) `isChromiumBinaryRunning()` splits ps output on whitespace and takes the first token, so any install path containing a space (e.g. `/Applications/My Chromium.app/...`) silently fails the preflight that protects destructive swap steps; (2) `launchChromium()` fire-and-forgets the spawn and shows `"Launched"` even when Chromium dies within milliseconds (wrong arch, Gatekeeper, bad signature); (3) if a large download is interrupted, the next install restarts from zero — wasting bandwidth on a 100+ MB archive; and (4) `appBundleFromBinary()` is called at render time inside `<InstallView />`, so a typo in the `chromiumPath` preference crashes the view instead of surfacing a recoverable error.

## What Changes

- **Fix process match for paths with spaces.** Replace the whitespace-split strategy in `isChromiumBinaryRunning()` with a prefix-based match against the full `chromiumPath` so install preflight works for any install location.
- **Add a launch liveness check.** `launchChromium()` becomes an async function that returns after a 750 ms grace window, observing `exit` / `error` on the spawned child during that window. If Chromium exits non-zero within the window, the promise rejects; callers surface a failure toast instead of a misleading `"Launched"` HUD. After the window, the child is `unref()`-ed and treated as successful.
- **Add resumable download support.** The installer keeps the `.part` file across interrupted runs when it matches the current revision. On the next install attempt, the pipeline issues a `Range: bytes=N-` request and appends to the existing part file; a full `200 OK` response falls back to restart; a `416` (range not satisfiable) invalidates the part and restarts. Parts for other revisions or platforms are pruned on startup.
- **Guard `InstallView` against bad `chromiumPath`.** Wrap `appBundleFromBinary()` in a render-safe path so a misconfigured preference renders a friendly error `<Detail>` with remediation instead of crashing.
- **Clarify swap-failure messaging.** When the destructive swap step (`rm` then `rename` of the app bundle) fails mid-flight, the failure toast and the rendered `Install Failed` state SHALL state clearly that the previous Chromium bundle is gone and recommend re-running Install. No backup/rollback is introduced (per product decision — fail loud, reinstall).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chromium-installer`: adds download-resume behavior; strengthens the "refuses to run when Chromium is running" requirement to work for paths containing spaces; adds render-safe bundle-path resolution in `<InstallView />`; adds post-failure messaging requirement for the destructive swap step.
- `quick-launch`: replaces the fire-and-forget `spawn + unref` with a liveness-checked launch that surfaces early crashes to the caller.

## Impact

- **Code**: `raycast/src/chromium/processes.ts` (ps matching), `raycast/src/chromium/launcher.ts` (`launchChromium` becomes async with liveness check), `raycast/src/chromium/installer.ts` (Range-resume download, prune-stale-parts, clearer swap error), `raycast/src/install/InstallView.tsx` (render guard + failure copy), `raycast/src/launch.ts` and `raycast/src/Tempchrome.tsx` (await the async launch, handle rejection), `raycast/src/profiles/ProfileList.tsx` (await the async relaunch).
- **APIs**: `launchChromium()` signature changes from `void` to `Promise<void>`. This is a **BREAKING** internal API change — all call sites must be updated.
- **Dependencies**: No new npm dependencies. `HTTP Range` is served by `storage.googleapis.com`; no server-side changes required.
- **UX**: Quick Launch blocks up to ~750 ms before reporting success. Animated toast/HUD shown during the wait.
- **Risk**: Low. The liveness window is bounded; resume is additive; the ps fix only changes behavior for install paths with spaces (currently broken). No data-loss path is introduced.
