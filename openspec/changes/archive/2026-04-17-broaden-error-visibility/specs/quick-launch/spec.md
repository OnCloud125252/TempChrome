## MODIFIED Requirements

### Requirement: Opportunistic auto-cleanup sweep runs after every launch
The system SHALL, after successfully spawning Chromium, invoke an asynchronous sweep that trashes every profile in the auto-cleanup registry whose Chromium process is no longer running. The sweep SHALL be fire-and-forget — the command SHALL NOT `await` it. Sweep failures SHALL NOT block the originating launch's HUD or failure toast. Sweep failures SHALL surface through `reportError("Auto-cleanup sweep failed", error)` (from the `error-reporting` capability), which renders a non-blocking failure toast; they SHALL NOT be silently swallowed.

#### Scenario: Stale auto-cleanup profile is trashed
- **WHEN** the sweep runs
- **AND** the registry at `LocalStorage` key `"tempchrome.auto-cleanup-registry"` contains an entry `P → <timestamp>`
- **AND** the output of `execFile("ps", ["-Ao", "args="])` contains no line with the substring `"--user-data-dir=" + P`
- **THEN** the system SHALL call `execFile("trash", [P])`
- **AND** remove key `P` from the registry
- **AND** write the updated registry back to `LocalStorage`

#### Scenario: In-use auto-cleanup profile is preserved
- **WHEN** the sweep runs
- **AND** the registry contains an entry `P → <timestamp>`
- **AND** the output of `ps -Ao args=` contains at least one line with the substring `"--user-data-dir=" + P`
- **THEN** the system SHALL NOT delete `P`
- **AND** SHALL leave the registry entry intact

#### Scenario: Sweep errors surface via reportError
- **WHEN** the sweep runs
- **AND** any operation fails (e.g., `ps` fails, `trash` fails, `LocalStorage` is unavailable, or JSON parse of the registry fails)
- **THEN** the system SHALL catch the error
- **AND** SHALL call `reportError("Auto-cleanup sweep failed", error)` — which logs and shows a non-blocking failure toast
- **AND** the HUD from the originating launch command SHALL still have been shown
- **AND** the launch's success state SHALL NOT be downgraded to failure

#### Scenario: Sweep does not block launch
- **WHEN** the launch command triggers the sweep
- **THEN** the sweep SHALL be invoked as a non-awaited async call (fire-and-forget)
- **AND** the originating command SHALL call `showHUD` and return without waiting for the sweep to complete

## ADDED Requirements

### Requirement: Auto-cleanup registry writes are serialized
The auto-cleanup registry SHALL be mutated exclusively through an `updateRegistry(mutator: (current: Registry) => Registry): Promise<Registry>` primitive exposed by `raycast/src/profiles/autoCleanup.ts`. The module SHALL maintain a single in-memory promise chain; each invocation of `updateRegistry` SHALL `await` the previous chain link before reading from `LocalStorage`, applying the mutator, and writing back. No code in `raycast/src/**` SHALL call `LocalStorage.setItem(AUTO_CLEANUP_REGISTRY_KEY, ...)` directly; all writes SHALL flow through `updateRegistry`.

#### Scenario: Two concurrent `markForAutoCleanup` calls both persist
- **WHEN** two Quick Launches both call `markForAutoCleanup(pathA)` and `markForAutoCleanup(pathB)` simultaneously
- **THEN** after both promises resolve, the persisted registry SHALL contain both `pathA` and `pathB` as keys
- **AND** the two writes SHALL be linearized by the in-module promise chain such that the second `updateRegistry` reads a registry that already includes the first's result

#### Scenario: Concurrent sweep + mark do not lose entries
- **WHEN** a sweep is in progress (reading the registry and removing entry `pathOld`)
- **AND** a new launch calls `markForAutoCleanup(pathNew)` before the sweep's `updateRegistry` resolves
- **THEN** the `markForAutoCleanup` call SHALL wait for the sweep's `updateRegistry` to complete
- **AND** the final persisted registry SHALL contain `pathNew` (and SHALL NOT contain `pathOld`)

#### Scenario: All registry accessors go through the primitive
- **WHEN** a reviewer greps `raycast/src/**` for `LocalStorage.setItem` with the `AUTO_CLEANUP_REGISTRY_KEY` key
- **THEN** the only match SHALL be inside the body of `updateRegistry` within `raycast/src/profiles/autoCleanup.ts`

#### Scenario: unmarkAutoCleanup uses updateRegistry
- **WHEN** `unmarkAutoCleanup(path)` runs
- **THEN** it SHALL call `updateRegistry((current) => { const next = { ...current }; delete next[path]; return next; })`
- **AND** SHALL NOT call `readRegistry`-then-`writeRegistry` as two separate operations
