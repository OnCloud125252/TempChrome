## Context

Three independent issues live under the same quality umbrella — "the extension degrades silently": (1) a data race on the auto-cleanup registry, (2) a pile of `console.error(...)` calls that users never see, and (3) sequential `fs.readdir` walks in the profile list. Each is a small fix in isolation, but because they all touch the same code paths (`profiles/autoCleanup.ts`, `profiles/listing.ts`, `profiles/ProfileList.tsx`, `chromium/*`, `logs/tailer.ts`), it's cleaner to land them as one change with one migration cost.

This design covers the *how*. The *what* is in `specs/error-reporting/spec.md`, `specs/profile-manager/spec.md`, and `specs/quick-launch/spec.md`.

## Goals / Non-Goals

**Goals:**

- A single `reportError(context, error, opts?)` helper that every non-fatal error path uses. Logs always, toasts by default, silent opt-out available.
- Atomic registry mutations via a single module-scoped promise chain, so markForAutoCleanup / unmarkAutoCleanup / sweep never clobber each other.
- `listProfiles()` completes in ~ceil(N/4) × single-walk time, not N × single-walk time, without materially complicating the code.

**Non-Goals:**

- Serializing registry writes across multiple extension processes or across Raycast reloads. `LocalStorage` is already per-extension-process-state; cross-process races are handled by the fact that only one extension instance runs at a time.
- Replacing `LocalStorage` with a file-backed store. The TOCTOU fix is strictly in-process.
- Adding retry logic inside `reportError`. If a toast fails, we log and move on.
- Structured logging / telemetry. This is local, interactive macOS UX, not a background daemon.
- Making the sweep itself awaited. It stays fire-and-forget; only its error surfacing changes.

## Decisions

### 1. `reportError` is a tiny helper, not a subscriber system

**Decision:**

```ts
// raycast/src/utils/reportError.ts
import { showFailureToast } from "@raycast/utils";

export async function reportError(
  context: string,
  error: unknown,
  options: { silent?: boolean } = {},
): Promise<void> {
  console.error(context, error);
  if (options.silent) return;
  try {
    await showFailureToast(error, { title: context });
  } catch (toastError) {
    console.error("reportError: showFailureToast rejected", toastError);
  }
}
```

That's the entire API. Every current `console.error(...)` call becomes one `reportError(...)` call. Greppability is deliberate: an ESLint rule (or just code-review grep) can verify the migration is complete by searching for `console.error` outside this file.

**Alternatives considered:**

- *Pub-sub pattern with subscribers for test doubles:* overkill for a single-process extension.
- *Import `console.error` wrapping at module load time:* implicit magic, harder to understand.
- *Toast-queue de-dup (skip showing the same toast twice within 500ms):* nice-to-have if error storms become a problem. Defer until observed.

### 2. Registry serialization via a single module-scoped promise chain

**Context:** `LocalStorage.getItem` / `setItem` are async. Today's `markForAutoCleanup` does a read-then-write with no ordering guarantee between concurrent callers:

```
  A: read → {}
  B: read → {}
  A: write { pathA: t1 }
  B: write { pathB: t2 }   ← overwrites A's write
```

**Decision:** Introduce an `updateRegistry` primitive that queues all mutations on a private promise chain:

```ts
// raycast/src/profiles/autoCleanup.ts
let writeChain: Promise<Registry> = Promise.resolve({});

export async function updateRegistry(
  mutator: (current: Registry) => Registry,
): Promise<Registry> {
  const next = writeChain.then(async () => {
    const current = await readRegistryInternal();
    const updated = mutator(current);
    await LocalStorage.setItem(AUTO_CLEANUP_REGISTRY_KEY, JSON.stringify(updated));
    return updated;
  });
  // Keep the chain alive even if this link rejects; otherwise a single
  // failed write would permanently wedge all subsequent writes.
  writeChain = next.catch(() => readRegistryInternal());
  return next;
}
```

`markForAutoCleanup(path)` becomes `updateRegistry((r) => ({ ...r, [path]: Date.now() }))`. The sweep's internal registry mutation is also rewritten on top of this primitive.

**Failure handling:** `writeChain.catch(() => readRegistryInternal())` ensures a rejected link doesn't stall the queue. Subsequent `updateRegistry` calls re-read fresh state and proceed.

**Alternatives considered:**

- *Mutex with `navigator.locks`:* not available in Raycast's Node/Bun runtime.
- *Per-key locking:* this is a single-key store; the scope is correct.
- *Optimistic concurrency with version tags:* overkill for a ~10-entry JSON blob.

### 3. Parallel profile sizing via a small `mapWithConcurrency` helper

**Decision:** Introduce a minimal concurrency-bounded map:

```ts
// raycast/src/utils/concurrency.ts
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function pump(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => pump());
  await Promise.all(workers);
  return results;
}
```

`listProfiles()` uses it as:

```ts
const infos = await mapWithConcurrency(directories, 4, async (entry) => {
  // existing per-directory stat + computeDirectorySize + return ProfileInfo
});
```

**Why 4:** Typical macOS SSDs parallelize `readdir`/`stat` well up to ~4 concurrent walkers before I/O queue saturation kicks in. Spinning-disk laptops are rare now, and even on those, 4 is safer than unbounded. Empirically we can tune later; the constant is trivial to move.

**Alternatives considered:**

- *`p-limit` npm dep:* adds a dependency for ~15 lines of code. Skip.
- *`Promise.all(directories.map(...))` unbounded:* on a user with 100 profiles this spawns 100 concurrent walks. Cap it.
- *Streaming results as they arrive (AsyncIterator):* more complex; the UI already shows a spinner, a bulk reveal after list completion is fine.

### 4. Migration of `console.error` call sites is enumerated in the spec

**Decision:** Rather than leave the migration as "grep and fix", the `error-reporting` spec enumerates every current `console.error` site and its target `reportError` invocation. This makes the PR reviewable as a checklist and avoids ambiguity about which calls should be silent. The list in the spec is the authoritative inventory.

**Alternatives considered:**

- *Keep the migration fuzzy ("all console.errors"):* easier for the reviewer to miss one.
- *Add an ESLint rule:* good idea for enforcement, but separate work; the enumerated list serves the first migration.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Toast storms.** A misbehaving `ps` that always errors would surface a toast on every list refresh. | Critical silent-path errors (`getChromiumProcessArgs`, tailer internals) are tagged `{ silent: true }` per the spec's enumeration. User-facing errors stay visible. |
| **Registry chain wedges on persistent `LocalStorage` failure.** If `LocalStorage` throws every time, every `updateRegistry` rejects, but `writeChain` catches and recovers to a read — so subsequent operations still try. | The chain-catch protects progress; the user sees a toast via `reportError` on each failure, which is the correct debug signal. |
| **Parallel sizing increases peak memory for a few hundred ms.** Four simultaneous walks read directory entries into memory briefly. | Bounded at 4 concurrent; `computeDirectorySize` doesn't retain file contents, only counters. Peak memory delta is negligible. |
| **Rewriting every `console.error` call is a large blast-radius diff.** Easy to miss one during review. | The spec enumerates each site explicitly; tasks.md turns each into a checkbox; reviewer can grep `console.error` at the end. |
| **Relaxing "sweep errors are silent" is a visible behavior change.** A user whose `trash` CLI is missing will now see a failure toast on every launch where the sweep fires. | This is the user's stated preference (bump `console.error` to toast). If noise becomes a problem, the affected site moves back to `{ silent: true }` with a comment, no spec churn. |

## Migration Plan

One PR, but internally ordered as reviewable commits:

1. **Add `reportError` helper + tests.** Zero behavior change, just a new file.
2. **Migrate `console.error` call sites** one file at a time. Each commit touches a single source file, making the grep of "what changed" trivial per commit.
3. **Introduce `updateRegistry` and migrate autoCleanup.ts callers.** The quick-launch spec's "sweep errors surface via reportError" scenario implicitly depends on this — both land together.
4. **Add `mapWithConcurrency` helper and use it in `listProfiles`.** Isolated perf fix; reverts cleanly.

Rollback is per-commit `git revert`. No persisted state changes.

## Open Questions

1. **Should `reportError` rate-limit?** If a tight loop calls it (e.g., tailer polling at 250ms with a persistent error), we'd fire a toast every 250ms. Current answer: the enumerated silent sites cover the known polling loops; if a new noisy site emerges, tag it `{ silent: true }`.
2. **Do we want an ESLint rule to forbid bare `console.error`?** Would codify the migration. Defer until the first migration ships and we see whether the convention holds.
3. **Is 4 the right parallelism for sizing?** If users report slowness on HDDs we can drop to 2; if SSDs benefit from 8 we can raise. Revisit after first real-world data.
