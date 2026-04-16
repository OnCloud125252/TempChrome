---
name: raycast-extension
description: Build and maintain Raycast extensions with React, TypeScript, and bun. Triggers on @raycast/api, List, Grid, Detail, Form, ActionPanel, AI.ask, LocalStorage, Cache, showToast, BrowserExtension, useCachedPromise, and the Raycast `ray` CLI. Use when the user asks to create, fix, or extend a Raycast extension, command, tool, or UI primitive in this repo.
---

# Raycast Extension Development

Opinionated entry point for building Raycast extensions in this repo. Deep specs live under `references/api/*.md` — consult them for the full component surface. Keep this file scannable.

## Package Manager: bun only

This project uses **bun** exclusively. Do not introduce `npm`, `yarn`, or `pnpm` commands — not in scripts, docs, or examples. Translate any `npm run X` guidance to `bun run X`. The lockfile is `bun.lock` (text, Bun 1.2+); commit it, don't gitignore it.

For the `ray` CLI itself (`ray build`, `ray develop`, `ray lint`, `ray publish`, `ray login`), see the companion `ray` skill — don't re-document those commands here.

## Agent Workflow

When asked to implement or fix a Raycast feature:

1. **Identify the UI primitive** — `List`, `Grid`, `Detail`, `Form`, or `MenuBarExtra` (use the decision tree below).
2. **Consult the reference** — open `references/api/<name>.md` for the full prop surface before coding.
3. **Default feedback & storage**:
   - Feedback: `showToast` for Loading/Success/Failure states; `showHUD` only for quick confirmation after Raycast closes; `Alert` to confirm destructive actions.
   - Storage: `Cache` for transient/performance data (sync API); `LocalStorage` for persistent user data (async).
   - Gated APIs: always wrap `AI` and `BrowserExtension` in `environment.canAccess(...)` checks.
4. **Wire up the action** — every `Action` needs a toast/HUD **and** a keyboard shortcut (see the companion `raycast-ux-feedback` skill for the repo policy).
5. **Cite the ref** — when responding, link back to the specific `references/api/*.md` you used.

## UI Primitive Decision Tree

| Need | Component | Reference |
|------|-----------|-----------|
| Searchable text-heavy list | `List` | [list.md](references/api/list.md) |
| Image-heavy gallery | `Grid` | [grid.md](references/api/grid.md) |
| Collect user input | `Form` | [form.md](references/api/form.md) |
| Rich markdown + metadata | `Detail` | [detail.md](references/api/detail.md) |
| Persistent status-bar icon | `MenuBarExtra` | [menu-bar-commands.md](references/api/menu-bar-commands.md) |
| Background task only | `no-view` mode (no UI) | [package-structure.md](references/package-structure.md) |

## Command Modes

| Mode | Use case | Supports `interval` |
|------|----------|---------------------|
| `view` | UI with `List`/`Detail`/`Form`/`Grid` | No |
| `no-view` | Background task, clipboard, notifications | Yes |
| `menu-bar` | Menu bar icon with dropdown | Yes |

See [package-structure.md](references/package-structure.md) for the full manifest schema.

## React 19 Pitfalls (non-obvious footguns)

`@raycast/api@1.104+` declares **exact** peer deps:

```json
"@types/react": "19.0.10",
"@types/node": "22.13.10"
```

Using `^18.x` for `@types/react` breaks `ray build` with `Type 'bigint' is not assignable to type 'ReactNode'` — React 19 widened `ReactNode` and collides with React 18 types.

React 19 also removed the global `JSX` namespace. With `jsx: "react-jsx"` and React 19 types, `function Command(): JSX.Element` fails. Import the namespace explicitly:

```tsx
import type { JSX } from "react";

export default function Command(): JSX.Element { /* ... */ }
```

## Quick Cookbook

### List + ActionPanel

```tsx
import { ActionPanel, Action, List } from "@raycast/api";

export default function Command() {
  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search…" throttle>
      <List.Item
        title="Item Title"
        subtitle="Subtitle"
        accessories={[{ text: "Tag" }]}
        actions={
          <ActionPanel>
            <Action.Push title="View Details" target={<Detail markdown="# Details" />} />
            <Action.CopyToClipboard title="Copy" content="value" />
          </ActionPanel>
        }
      />
    </List>
  );
}
```

Refs: [list.md](references/api/list.md), [action-panel.md](references/api/action-panel.md), [actions.md](references/api/actions.md). Runnable: [examples/list-with-actions.tsx](examples/list-with-actions.tsx), [examples/list-with-detail.tsx](examples/list-with-detail.tsx).

### Detail (markdown + metadata)

```tsx
<Detail
  isLoading={isLoading}
  markdown={"# Heading\nContent here."}
  metadata={
    <Detail.Metadata>
      <Detail.Metadata.Label title="Status" text="Active" icon={Icon.Checkmark} />
    </Detail.Metadata>
  }
/>
```

Ref: [detail.md](references/api/detail.md). Runnable: [examples/detail-with-metadata.tsx](examples/detail-with-metadata.tsx).

### Form (always include SubmitForm)

```tsx
<Form
  actions={
    <ActionPanel>
      <Action.SubmitForm onSubmit={(values) => console.log(values)} />
    </ActionPanel>
  }
>
  <Form.TextField id="title" title="Title" placeholder="Enter title" />
  <Form.TextArea id="description" title="Description" />
</Form>
```

Ref: [form.md](references/api/form.md). Runnable: [examples/form-with-validation.tsx](examples/form-with-validation.tsx).

### Grid

Ref: [grid.md](references/api/grid.md). Runnable: [examples/grid-with-images.tsx](examples/grid-with-images.tsx).

### No-view background task

```tsx
import { showHUD, Clipboard, showToast, Toast } from "@raycast/api";

export default async function Command() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Working…" });
  try {
    const result = await doSomething();
    await Clipboard.copy(result);
    await showHUD("Done!");
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Failed";
    toast.message = error instanceof Error ? error.message : "Unknown error";
  }
}
```

### Feedback (toast, HUD, alert)

```tsx
await showToast({ style: Toast.Style.Success, title: "Success!" });
await showHUD("Done!"); // use when Raycast will close immediately
```

Raycast offers three feedback mechanisms: **Toast** for async progress and errors, **HUD** to confirm after Raycast closes, **Alert** to confirm a destructive action before proceeding. Refs: [toast.md](references/api/toast.md), [hud.md](references/api/hud.md), [alert.md](references/api/alert.md).

### Data fetching

```tsx
import { List } from "@raycast/api";
import { useFetch } from "@raycast/utils";

export default function Command() {
  const { data, isLoading } = useFetch<Item[]>("https://api.example.com/items");
  return (
    <List isLoading={isLoading}>
      {data?.map((item) => <List.Item key={item.id} title={item.name} />)}
    </List>
  );
}
```

For caching + stale-while-revalidate, see [references/performance.md](references/performance.md). Runnable: [examples/data-fetching.tsx](examples/data-fetching.tsx).

### Storage

```tsx
// Cache (sync, transient)
const cache = new Cache();
cache.set("key", "value");

// LocalStorage (async, persistent)
await LocalStorage.setItem("key", "value");
```

Refs: [caching.md](references/api/caching.md), [storage.md](references/api/storage.md).

### AI & Browser Extension (gated)

```tsx
if (environment.canAccess(AI)) {
  const result = await AI.ask("Prompt");
}

if (environment.canAccess(BrowserExtension)) {
  const tabs = await BrowserExtension.getTabs();
}
```

Refs: [ai.md](references/api/ai.md), [browser-extension.md](references/api/browser-extension.md), [environment.md](references/api/environment.md). Runnable: [examples/ai-integration.tsx](examples/ai-integration.tsx).

> AI requires Raycast Pro. Always gate on `environment.canAccess(AI)` — never assume availability.

### AppleScript (macOS integration)

```tsx
import { runAppleScript } from "@raycast/utils";

const url = await runAppleScript(`
  tell application "Google Chrome"
    return URL of active tab of front window
  end tell
`);
```

Ref: [system-utilities.md](references/api/system-utilities.md).

### Preferences

```tsx
import { getPreferenceValues } from "@raycast/api";

interface Preferences { apiKey: string }
const { apiKey } = getPreferenceValues<Preferences>();
```

See [package-structure.md](references/package-structure.md#preferences) for the manifest schema and [preferences.md](references/api/preferences.md) for the runtime API.

## Performance

For instant cold starts, sidecar preloading, SQLite URI mode, `execFile` vs `exec`, optimistic UI, and CLS avoidance — see the full guide at [references/performance.md](references/performance.md). This is where the "tiny delay" and "UI freezes during revalidation" bugs get fixed.

## Raycast Deeplinks & Auto-Reload

```bash
# Reload all extensions after a build
open "raycast://extensions/raycast/raycast/reload-extensions"

# Open Raycast
open "raycast://focus"

# Run any extension command
open "raycast://extensions/{author}/{extension}/{command}"
```

The default build script already chains a reload:

```json
"build": "ray build --skip-types -e dist -o dist && open raycast://extensions/raycast/raycast/reload-extensions"
```

## Development Workflow

```bash
bun install          # install deps
bun run dev          # hot-reload dev server (= ray develop)
bun run lint:fix     # auto-fix lint and formatting
bun run build        # production build into dist/
bun run publish      # submit to Raycast Store
```

For `ray` CLI flags and troubleshooting, defer to the companion `ray` skill.

## Reference Index

- **UI Components**
  - [action-panel.md](references/api/action-panel.md) · [actions.md](references/api/actions.md)
  - [detail.md](references/api/detail.md) · [form.md](references/api/form.md) · [grid.md](references/api/grid.md) · [list.md](references/api/list.md)
  - [user-interface.md](references/api/user-interface.md)
- **Interactivity**
  - [alert.md](references/api/alert.md) · [keyboard.md](references/api/keyboard.md) · [navigation.md](references/api/navigation.md) · [raycast-window-search-bar.md](references/api/raycast-window-search-bar.md)
- **Utilities & Services**
  - [ai.md](references/api/ai.md) · [browser-extension.md](references/api/browser-extension.md) · [clipboard.md](references/api/clipboard.md)
  - [environment.md](references/api/environment.md) · [oauth.md](references/api/oauth.md) · [system-utilities.md](references/api/system-utilities.md)
  - [hud.md](references/api/hud.md) · [toast.md](references/api/toast.md)
- **Data & Configuration**
  - [caching.md](references/api/caching.md) · [colors.md](references/api/colors.md) · [icons-images.md](references/api/icons-images.md)
  - [preferences.md](references/api/preferences.md) · [storage.md](references/api/storage.md)
- **Advanced**
  - [command-related-utilities.md](references/api/command-related-utilities.md) · [menu-bar-commands.md](references/api/menu-bar-commands.md)
  - [tool.md](references/api/tool.md) · [window-management.md](references/api/window-management.md)
- **Project-wide guides**
  - [performance.md](references/performance.md) · [package-structure.md](references/package-structure.md)
- **Runnable examples** — [examples/](examples/): `list-with-actions`, `list-with-detail`, `form-with-validation`, `detail-with-metadata`, `grid-with-images`, `data-fetching`, `ai-integration`, `menubar-extra`.
- **Companion skills** — `ray` (CLI), `raycast-ux-feedback` (toast + hotkey policy for every action).
