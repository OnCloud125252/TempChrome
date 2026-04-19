# error-reporting Specification

## Purpose
TBD - created by archiving change broaden-error-visibility. Update Purpose after archive.
## Requirements
### Requirement: Centralized reportError helper
The extension SHALL expose a helper function at `raycast/src/utils/reportError.ts` with the signature `reportError(context: string, error: unknown, options?: { silent?: boolean }): Promise<void>`. The helper SHALL always log to `console.error` with `context` and `error` as arguments, and SHALL, by default, call `showFailureToast(error, { title: context })` from `@raycast/utils`. When `options.silent === true`, the helper SHALL NOT call `showFailureToast`. The helper SHALL NOT throw; if `showFailureToast` itself rejects, that rejection SHALL be caught and logged but SHALL NOT propagate.

#### Scenario: Default call shows a toast and logs
- **WHEN** code calls `reportError("Sweep failed", error)`
- **THEN** `console.error("Sweep failed", error)` SHALL be invoked
- **AND** `showFailureToast(error, { title: "Sweep failed" })` SHALL be invoked
- **AND** the returned promise SHALL resolve (never reject)

#### Scenario: Silent opt-out suppresses the toast
- **WHEN** code calls `reportError("Tailer handle close failed", error, { silent: true })`
- **THEN** `console.error("Tailer handle close failed", error)` SHALL be invoked
- **AND** `showFailureToast` SHALL NOT be invoked

#### Scenario: showFailureToast rejection is swallowed
- **WHEN** `showFailureToast` rejects (for example because the command has exited and toasts cannot be shown)
- **THEN** `reportError` SHALL catch the rejection, log it to `console.error`, and resolve its own promise

### Requirement: All non-fatal runtime errors in `raycast/src/**` use reportError
Every non-fatal error path in `raycast/src/**` that previously called `console.error(...)` SHALL be migrated to call `reportError(context, error)` (with `{ silent: true }` when the error is not user-actionable). Direct calls to `console.error` SHALL remain ONLY inside `reportError` itself and in files explicitly exempted by a surrounding code comment explaining the exemption.

#### Scenario: Migration is enforced by convention
- **WHEN** a reviewer greps `raycast/src/**` for `console.error`
- **THEN** the only matches SHALL be inside `raycast/src/utils/reportError.ts`, or inside a block preceded by a comment of the form `// reportError-exempt: <reason>`

#### Scenario: Known migration sites
- **WHEN** the migration is complete
- **THEN** the following previously-silent sites SHALL route through `reportError`:
  - `chromium/launcher.ts` `clearQuarantine` failure → `reportError("Could not clear Chromium quarantine attributes", error)`
  - `chromium/processes.ts` `getChromiumProcessArgs` failure → `reportError("Could not list running processes", error, { silent: true })`
  - `chromium/processes.ts` `isChromiumBinaryRunning` failure → `reportError("Could not check running Chromium processes", error, { silent: true })`
  - `profiles/autoCleanup.ts` sweep per-path failure → `reportError("Auto-cleanup failed to remove a profile", error)`
  - `profiles/autoCleanup.ts` `runSweepFireAndForget` outer failure → `reportError("Auto-cleanup sweep failed", error)`
  - `profiles/ProfileList.tsx` mount-sweep failure → `reportError("Auto-cleanup sweep failed", error)`
  - `profiles/listing.ts` per-profile stat failure → `reportError("Could not read profile directory", error, { silent: true })`
  - `logs/tailer.ts` read failure → `reportError("Log tail read failed", error, { silent: true })`
  - `logs/tailer.ts` handle close failure → `reportError("Log tail handle close failed", error, { silent: true })`
  - `logs/tailer.ts` stat failure (non-ENOENT) → `reportError("Log tail stat failed", error, { silent: true })`
  - `chromium/installer.ts` xattr spawn-error / non-zero-exit → `reportError("xattr clear failed (install)", error, { silent: true })`

