## Why

Three otherwise-silent issues quietly erode the extension's reliability: (1) the auto-cleanup registry in `LocalStorage` has no atomic read-modify-write, so two rapid Quick Launches or a concurrent launch+sweep can drop entries, producing orphan profiles that never get cleaned up; (2) roughly a dozen `console.error(...)` calls swallow background failures — xattr failures, sweep removal failures, profile-size stat failures, tailer read failures — where the user sees nothing and has no way to know degradation is happening; (3) `listProfiles()` walks every profile's directory tree sequentially, so a user with 10–20 fat profiles spends multiple seconds staring at a spinner on each open of Manage Temp Profiles.

None of these will ship a product-breaking bug on its own, but together they create a "why did auto-cleanup stop working?" or "why is this so slow?" class of support load that's hard to debug because no log, toast, or trace points at the cause.

## What Changes

- **Introduce a `reportError(context, error, opts?)` helper.** Every existing `console.error(...)` call in `raycast/src/**` is migrated to `reportError`. The helper always logs to `console.error` (preserving today's dev signal) and by default surfaces a `showFailureToast` with `context` as the title. Truly internal call sites (e.g. tailer `close()` on unref) opt out via `{ silent: true }`.
- **Serialize auto-cleanup registry writes.** The `raycast/src/profiles/autoCleanup.ts` module gains an in-module promise-chain queue so every read-modify-write of the `LocalStorage` registry is atomic with respect to other writers in the same extension process. Callers use `updateRegistry((current) => next)` instead of read-then-write.
- **Parallelize profile sizing with a concurrency cap.** `listProfiles()` computes `computeDirectorySize` for each profile in parallel, bounded at 4 concurrent walks. For a user with 20 profiles, this roughly quarters the time spent staring at the list's spinner.
- **Surface previously-swallowed sweep errors.** The `quick-launch` spec currently mandates silent-swallowing of sweep errors. That rule is relaxed: sweep errors now surface through `reportError` as a non-blocking toast with title `"Auto-cleanup sweep failed"`, while still not blocking or failing the originating launch.

## Capabilities

### New Capabilities

- `error-reporting`: Centralized error-reporting policy for the extension. Defines the `reportError(context, error, opts?)` helper contract, the toast vs. silent default, and the migration rule that every non-fatal runtime error path in `raycast/src/**` must use this helper.

### Modified Capabilities

- `profile-manager`: `listProfiles()` computes directory sizes with bounded parallelism; stat and size-walk failures now flow through `reportError` instead of `console.error`.
- `quick-launch`: Registry reads and writes are serialized through an atomic update path; the sweep-errors-are-silent rule is relaxed to a "sweep errors surface through `reportError` but don't block the launch" rule.

## Impact

- **Code**: New `raycast/src/utils/reportError.ts`; every `console.error` in `raycast/src/**` migrated; `raycast/src/profiles/autoCleanup.ts` rewritten to use an `updateRegistry` primitive; `raycast/src/profiles/listing.ts` uses a small `mapWithConcurrency` helper for sizing.
- **APIs**: Internal-only. `readRegistry` / `writeRegistry` become `updateRegistry((current) => next)`; callers change accordingly.
- **Dependencies**: None. All changes are in-process.
- **UX**: More toasts when things go wrong (explicit user choice, per product direction). Slightly faster Manage Temp Profiles list for users with many fat profiles.
- **Risk**: Low. `reportError` is additive; the registry serialization fix is strictly a correctness improvement; parallel sizing only touches read-only `fs` walks.
