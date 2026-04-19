## Context

The `chromiumPath` extension preference currently asks the user for a full binary path (`~/Applications/Chromium.app/Contents/MacOS/Chromium`). Internally, every consumer falls into one of two groups:

1. **Spawn / exists / ps-match callers** — `launchChromium`, `chromiumExists`, `isChromiumBinaryRunning`. They need the binary path and never touch the bundle.
2. **Bundle-operation callers** — `clearQuarantine` (`xattr -cr <bundle>`), the installer's `fs.rm(appBundlePath)` + `fs.rename(sourceApp, appBundlePath)`, and `InstallView`'s target-path UI. They need the `.app` bundle root and derive it via `appBundleFromBinary()` — a function that walks the path segments right-to-left looking for one ending in `.app` and throws if none is found.

The preference's flexibility is a fiction: although the textfield accepts any string, the `appBundleFromBinary()` walk hard-requires a `.app` segment. The `harden-install-and-launch` proposal just added a render-safe `useMemo` wrapper in `InstallView` specifically to catch the throw on malformed input. That wrapper is a workaround for an input shape that shouldn't have been exposed.

The same real-world defaults hold for ~every user: the bundle is always named `Chromium.app`, the executable is always `Contents/MacOS/Chromium`, the only thing that varies is the enclosing directory. Collapsing the pref to that single variable simplifies the API surface, the render path, and the user-facing configuration.

This change does NOT touch `cli/tempchrome.sh`, which takes its Chromium path via its own CLI argument.

## Goals / Non-Goals

**Goals:**

- Rename the extension preference from `chromiumPath` to `chromiumInstallDir`, default `~/Applications`.
- Expose `installDir`, `appBundlePath`, and `binaryPath` as pre-computed fields on the return value of `getPreferences()`. No consumer calls any derivation helper at runtime.
- Delete `appBundleFromBinary()` and its single-use `useMemo` render guard in `InstallView.tsx`.
- Keep every other behaviour identical: the prefix-matching `isChromiumBinaryRunning`, the 750 ms launch liveness window, the resumable downloader, the swap-failure messaging — none of those change.

**Non-Goals:**

- Supporting Chromium derivatives under alternative bundle names (Brave, Thorium, Arc). The bundle name is hard-coded to `Chromium.app`; adding an override pref is deferred.
- Runtime migration from the old `chromiumPath` preference key. Existing Raycast pref-store entries for `chromiumPath` become dead data; users re-set `chromiumInstallDir` once.
- Changing `tempBaseDir` or any Quick Launch command-level preference.
- Shipping before `harden-install-and-launch` is archived. This change deletes that change's §4 guard, so it must land afterward.

## Decisions

### 1. Single directory preference, no bundle-name escape hatch

**Context:** The current preference technically allows the user to point at `~/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. No scenario in the project's test suite or user docs exercises this, and the installer hard-codes the extracted bundle name to `Chromium.app` anyway. Keeping the illusion of flexibility costs us a throwing derivation helper + a render guard.

**Decision:** Hard-code the bundle name to `Chromium.app` and the binary name to `Chromium`. The user's only knob is the enclosing directory (`~/Applications`, `/Applications`, or anywhere else).

**Alternatives considered:**

- *Two prefs — `chromiumInstallDir` + optional `chromiumBundleName`:* supports derivatives cleanly but adds UI surface for a niche use case. The `cli/tempchrome.sh` side of the project only installs Chromium, so the extension staying aligned keeps the ecosystem coherent.
- *Keep `chromiumPath`, add validation at the pref boundary instead of in `InstallView`:* addresses the crash but keeps the 4-segment typing burden and the pretence of path flexibility.

### 2. Derivation happens in `getPreferences()`, not at every call site

**Context:** Today `appBundleFromBinary(chromiumPath)` is called at multiple sites (installer top-of-flow, `clearQuarantine`, `InstallView` render). Each call redoes the parse.

**Decision:** `getPreferences()` returns a single object with all three derived fields:

```ts
{
  installDir:    expandTilde(raw.chromiumInstallDir),
  appBundlePath: path.join(installDir, "Chromium.app"),
  binaryPath:    path.join(appBundlePath, "Contents", "MacOS", "Chromium"),
  tempBaseDir:   expandTilde(raw.tempBaseDir),
}
```

Every caller picks the field it needs. `appBundleFromBinary()` is deleted entirely.

**Alternatives considered:**

- *Keep a utility function that composes the three paths on demand:* no caller benefits, and having the fields on the preferences object makes the dependency graph explicit in types.

### 3. Hard-break migration, no old-key fallback

**Context:** Raycast stores per-extension preferences in its own store. There is no programmatic way to check whether the old `chromiumPath` key has a customized value, and even if we added a read-old-write-new shim, we would carry dead code forever for an optional one-time migration.

**Decision:** Rename the key in `package.json` from `chromiumPath` to `chromiumInstallDir`. Raycast treats this as a new preference with its own default (`~/Applications`). Any existing `chromiumPath` value in a user's Raycast pref store becomes unread dead data; the new default fills in for every install. Users who customised the old preference re-configure once after updating.

**Rationale for accepting the break:** The project has no published Store release yet; the user base is small; the default has always been `~/Applications/Chromium.app/...`, so users on the default see zero change in behaviour. The blast radius is bounded to "users who hand-set a non-default path," who will notice the first time they launch and see the new default doesn't match their setup.

**Alternatives considered:**

- *Read-old-write-new shim in `getPreferences()`:* add a one-time migration that reads `chromiumPath`, walks back to its `.app`, stores the parent directory under `chromiumInstallDir`. Cost: carrying the walk logic (the very thing we're deleting) for an indefinite migration window. Benefit: invisible upgrade for customised users. Net: not worth the carried complexity.
- *Keep the old key as a hidden fallback when `chromiumInstallDir` is unset:* Raycast's preferences model assigns defaults eagerly, so `chromiumInstallDir` is never "unset" in practice. The fallback never fires.

### 4. Delete the `InstallView` render guard in the same change

**Context:** The `harden-install-and-launch` §4 guard exists exclusively to catch `appBundleFromBinary()` throwing at render time. Once that function is gone, the guard catches nothing.

**Decision:** Delete the `AppBundleResolution` discriminated union, the `"Invalid Chromium Path"` `<Detail>` branch, the `badPathError` state, and the `useEffect` that fires `showFailureToast`. This keeps InstallView focused on its happy path + the real failure states (network, extraction, preflight, swap).

**Alternatives considered:**

- *Leave the guard in place as defence-in-depth:* dead code that confuses future readers. The preference shape makes the failure impossible by construction; keeping the guard suggests otherwise.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Users with customized `chromiumPath` lose their setting.** On update, their Raycast pref-store entry for `chromiumPath` is ignored; `chromiumInstallDir` defaults to `~/Applications`. If their old bundle lives elsewhere, the first install/launch silently targets the wrong location. | The change's release notes / changelog MUST call this out explicitly. Users on the default see no change; users with custom paths will either notice immediately (launch fails to find their bundle) or land at `~/Applications`, which is a reasonable default. |
| **Non-Chromium-named bundles become unsupported.** A user who installed Thorium or Brave and pointed `chromiumPath` there will no longer work. | Accepted per product decision ("never had it, don't want it"). Users on derivatives can keep using `cli/tempchrome.sh` directly, which takes an arbitrary path argument. |
| **`path.join(installDir, "Chromium.app")` does not validate that the directory exists.** A typo in `chromiumInstallDir` produces a well-formed but nonexistent path. | Existing failure paths handle this: `chromiumExists(binaryPath)` returns false → "Chromium not found" toast; the installer's `ensureParentDir` creates the install dir if possible, or fails loudly. |
| **The change lands after `harden-install-and-launch` but before that change archives.** If `harden-install-and-launch` hasn't been archived, the §4 guard doesn't exist in `openspec/specs/chromium-installer/spec.md` yet — the REMOVED requirement would reference something not in the baseline. | Sequence explicitly: archive `harden-install-and-launch` first (which adds the guard requirement to the baseline spec), then open this change's proposal. The "Non-Goals" section above makes this ordering binding. |

## Migration Plan

Single commit. Order within the commit:

1. Rename preference in `raycast/package.json` (`chromiumPath` → `chromiumInstallDir`, default `~/Applications`, title/description updated).
2. Update `raycast/src/preferences.ts` to read the new key and compute `installDir`, `appBundlePath`, `binaryPath`.
3. Delete `appBundleFromBinary()` from `raycast/src/chromium/launcher.ts`.
4. Update `clearQuarantine` to accept `appBundlePath` directly (no internal walk).
5. Update `launchChromium` and `isChromiumBinaryRunning` call sites to pass `binaryPath`.
6. Update `runInstall` to read `appBundlePath` from preferences.
7. Delete the render guard branch in `raycast/src/install/InstallView.tsx`.
8. Run `bun run lint` to regenerate `raycast-env.d.ts` with the new preference type.
9. Run `bun run build` to confirm types compile.

Rollback: `git revert`. No persisted user data is changed by the extension itself; Raycast's pref store retains the dead `chromiumPath` entry which is ignored either way.

## Open Questions

1. **Should we add a release-notes entry surfacing the breaking change?** Yes, but that is a documentation task, not an artifact of this proposal. Can be added as a task in `tasks.md`.
2. **Is there appetite for a future `chromiumBundleName` pref to support derivatives?** Deferred explicitly. If a user reports wanting Brave/Thorium support, revisit with its own proposal; the derivation helper is trivial to restore for that case.
