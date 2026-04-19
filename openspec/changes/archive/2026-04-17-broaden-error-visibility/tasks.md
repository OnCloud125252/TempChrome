## 1. Introduce the reportError helper

- [x] 1.1 Create `raycast/src/utils/reportError.ts` exporting `reportError(context, error, options?): Promise<void>` that always `console.error(context, error)`, and by default `await`s `showFailureToast(error, { title: context })` wrapped in a try/catch that swallows and logs any toast rejection.
- [x] 1.2 Confirm the helper never throws by reading the file and mentally tracing the try/catch boundaries (no dedicated tests are required for such a small helper, but add one JSDoc example in the file).

## 2. Migrate known console.error call sites to reportError

- [x] 2.1 `raycast/src/chromium/launcher.ts:clearQuarantine` → `reportError("Could not clear Chromium quarantine attributes", error)`.
- [x] 2.2 `raycast/src/chromium/processes.ts:getChromiumProcessArgs` catch → `reportError("Could not list running processes", error, { silent: true })`.
- [x] 2.3 `raycast/src/chromium/processes.ts:isChromiumBinaryRunning` catch → `reportError("Could not check running Chromium processes", error, { silent: true })`.
- [x] 2.4 `raycast/src/profiles/autoCleanup.ts` sweep per-path remove failure → `reportError("Auto-cleanup failed to remove a profile", error)`.
- [x] 2.5 `raycast/src/profiles/autoCleanup.ts:runSweepFireAndForget` outer catch → `reportError("Auto-cleanup sweep failed", error)`.
- [x] 2.6 `raycast/src/profiles/ProfileList.tsx` mount-sweep catch → `reportError("Auto-cleanup sweep failed", error)`.
- [x] 2.7 `raycast/src/profiles/listing.ts:listProfiles` per-profile stat catch → `reportError("Could not read profile directory", error, { silent: true })`.
- [x] 2.8 `raycast/src/logs/tailer.ts` read failure → `reportError("Log tail read failed", error, { silent: true })`.
- [x] 2.9 `raycast/src/logs/tailer.ts` handle close failure → `reportError("Log tail handle close failed", error, { silent: true })`.
- [x] 2.10 `raycast/src/logs/tailer.ts` tick stat failure (non-ENOENT) → `reportError("Log tail stat failed", error, { silent: true })`.
- [x] 2.11 `raycast/src/chromium/installer.ts` xattr spawn-error and non-zero-exit → `reportError("xattr clear failed (install)", error, { silent: true })`.
- [x] 2.12 Grep `raycast/src/**` for `console.error` and verify only `reportError.ts` still contains it (beyond any explicitly-commented exemptions).

## 3. Serialize auto-cleanup registry writes

- [x] 3.1 In `raycast/src/profiles/autoCleanup.ts`, rename the current `readRegistry` to `readRegistryInternal` (keep same body).
- [x] 3.2 Add a module-scoped `let writeChain: Promise<Registry> = Promise.resolve({})`.
- [x] 3.3 Implement `updateRegistry(mutator: (current: Registry) => Registry): Promise<Registry>` that chains off `writeChain`, reads fresh, applies the mutator, writes back, and updates `writeChain` with `.catch(() => readRegistryInternal())` so a failed write doesn't wedge the chain.
- [x] 3.4 Re-implement `markForAutoCleanup(path)` as `updateRegistry((current) => ({ ...current, [path]: Date.now() }))`.
- [x] 3.5 Re-implement `unmarkAutoCleanup(path)` as `updateRegistry((current) => { const next = { ...current }; delete next[path]; return next; })`.
- [x] 3.6 Re-implement `performSweep` so the per-path registry mutation goes through `updateRegistry` instead of the current `await writeRegistry(registry)` pattern. The sweep still reads the initial registry upfront to decide which paths to check; only the final write is channelled through `updateRegistry`.
- [x] 3.7 Update `raycast/src/profiles/ProfileList.tsx:handleDeleteAll` so its registry trim also flows through `updateRegistry` — replace the `readRegistry` + `writeRegistry` pair with a single `updateRegistry` call.
- [x] 3.8 Remove the now-unused `writeRegistry` export, or retain it as `@deprecated` if the migration is staged — simplest path is to remove it in the same PR.
- [x] 3.9 Grep `raycast/src/**` for `LocalStorage.setItem("tempchrome.auto-cleanup-registry"` and verify the only match is inside `updateRegistry` in `autoCleanup.ts`.
- [x] 3.10 Hand-exercise: trigger two Quick Launches in < 500 ms (bind both Launch Now and the hotkey, press both), then open Manage Temp Profiles and confirm BOTH new profiles carry the auto-cleanup badge.

## 4. Parallelize profile sizing

- [x] 4.1 Create `raycast/src/utils/concurrency.ts` with a `mapWithConcurrency<T, R>(items, limit, worker)` helper that runs at most `limit` workers in parallel and preserves input order in the returned array.
- [x] 4.2 Refactor `raycast/src/profiles/listing.ts:listProfiles` to replace its `for (const entry of directories)` loop with a `mapWithConcurrency(directories, 4, async (entry) => { ... })` call. The worker body SHALL match today's per-entry logic (stat + size walk + inUse / autoCleanup derivation + ProfileInfo shape).
- [x] 4.3 Filter the returned array for `undefined` (skipped profiles that failed the per-entry try/catch) before sorting, to match today's behavior.
- [x] 4.4 Hand-exercise: populate `/tmp/tempchrome_profile` with 10+ idle profile directories (copy existing ones) and confirm the list's spinner clears in noticeably less time than before.

## 5. Adjust the sweep-errors spec scenario behavior

- [x] 5.1 Confirm that after task 2.5 / 2.6 the sweep's outer and per-path failures both surface via `reportError`, matching the MODIFIED `quick-launch` spec scenario "Sweep errors surface via reportError".
- [x] 5.2 Verify that the launch's success HUD is still shown when the sweep fails (the sweep is still fire-and-forget; its toast surfaces alongside the HUD).
- [x] 5.3 Hand-exercise: temporarily rename the `trash` CLI on `$PATH` to force sweep failures, trigger a launch, and confirm both the success HUD AND the "Auto-cleanup sweep failed" toast appear.
- [x] 5.4 Restore the `trash` CLI.

## 6. Validate and ship

- [x] 6.1 Run `bun run lint` and fix any lint findings.
- [x] 6.2 Run `bun run build` and confirm a clean build.
- [x] 6.3 Run `bun run dev` and smoke-test: list 10+ profiles (verify fast sizing), launch (verify success HUD still shows even when the sweep toast also appears), Quick-Launch rapidly twice (verify both auto-cleanup entries persist).
- [x] 6.4 Update `raycast/CLAUDE.md` if any behavior notes need to change (e.g. note that `reportError` is the convention and that sweep errors now surface as toasts).
- [ ] 6.5 Stage changes and verify the pre-commit / pre-push hooks pass.
