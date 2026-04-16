---
name: raycast-ux-feedback
description: Project-wide UX policy for Raycast commands in this repo — every user-triggered action MUST wire up a toast (or HUD) for feedback AND a keyboard shortcut for discoverability. Use when adding or modifying any `Action`, `Action.Push`, `Action.SubmitForm`, `<List>`, `<Form>`, or `<Detail>` in `raycast/src/`. Also use when touching `handleXxx` functions that drive actions, when designing a new command, or when reviewing a PR that adds UI.
---

# Raycast UX Feedback & Shortcuts

Every user-triggered action in this extension must give **two things**:

1. **Visible feedback** — a `Toast` (in-view) or `showHUD` (post-dismiss) so the user knows what happened.
2. **A keyboard shortcut** — except for the single primary action per ActionPanel, which binds to ⏎ automatically.

Raycast's "bottom bar" is not customizable, but these two mechanisms fully replace it: toasts show *what happened*, and shortcuts surface *what you can do* in the ⌘K panel.

## Rule 1: Feedback on every action

| Action outcome           | Use                                           |
| ------------------------ | --------------------------------------------- |
| Starts long-running work | `showToast({ style: Animated, title: "…" })` — keep the handle, mutate on completion |
| Success (stays in view)  | Same toast, set `toast.style = Success`; set `toast.title` + optional `toast.message` |
| Success (dismisses view) | `toast.hide()` then `showHUD("…")` or `popToRoot()` — HUD shows a system banner after close |
| Failure                  | `showFailureToast(error, { title: "…" })` from `@raycast/utils` |
| Destructive completed    | Success toast with **quantitative detail** ("Freed 45 MB", "Deleted 3 profiles") |
| Nothing-to-do            | `showToast({ style: Failure, title: "Nothing to delete" })` — failure-style so it reads as a blocker, not a success |

### Animated → Success/Failure pattern

```ts
const toast = await showToast({
  style: Toast.Style.Animated,
  title: "Deleting profile…",
});
try {
  await doWork();
  toast.style = Toast.Style.Success;
  toast.title = "Deleted";
  toast.message = `Freed ${formatBytes(size)}`;
} catch (error) {
  toast.hide();
  await showFailureToast(error, { title: "Delete failed" });
}
```

### no-view commands

`no-view` commands (like `launch.ts`) have no panel to host a toast — use `showHUD` only. Enrich the message with details: profile ID, flag count, mode flags. Don't leave users guessing what just happened.

```ts
const parts = [
  values.autoCleanup ? "Launched" : "Launched (persistent)",
  `profile ${profileId}`,
];
if (flagCount > 0) parts.push(`${flagCount} flag${flagCount === 1 ? "" : "s"}`);
await showHUD(parts.join(" · "));
```

## Rule 2: Shortcut on every action

The first `<Action>` in an `<ActionPanel>` is invoked by ⏎ automatically — it doesn't need a `shortcut` prop. **Every other action** must declare one. Stick to Raycast's conventions so users don't have to relearn bindings per command:

| Intent                       | Shortcut                                    |
| ---------------------------- | ------------------------------------------- |
| Primary (only one per panel) | ⏎ (implicit — no `shortcut` prop)           |
| Alternate primary / edit     | `{ modifiers: ["cmd"], key: "return" }`     |
| Copy secondary content       | `{ modifiers: ["cmd", "shift"], key: "c" }` |
| Open in Finder               | `{ modifiers: ["cmd"], key: "o" }`          |
| Refresh list                 | `{ modifiers: ["cmd"], key: "r" }`          |
| Custom tool action           | `{ modifiers: ["cmd", "shift"], key: "k" }` (plain ⌘K is reserved by Raycast for the ActionPanel) |
| Back to root                 | `{ modifiers: ["cmd"], key: "[" }`          |
| Destructive — single item    | `{ modifiers: ["ctrl"], key: "x" }`         |
| Destructive — bulk / clear   | `{ modifiers: ["cmd", "shift"], key: "delete" }` or `"backspace"` |
| Reset form                   | `{ modifiers: ["cmd", "shift"], key: "r" }` |
| Navigate into subcommand     | First letter of name: ⌘L, ⌘R, ⌘M, ⌘I… (avoid ⌘P and ⌘K — both reserved by Raycast) |

Prefer `Action.Style.Destructive` on any delete/clear/remove — Raycast colors it red and confirms via ⌘K before firing.

### Root-list navigation

For a root List that routes into subviews (like `tempchrome.tsx`), bind each child `Action.Push` to a letter shortcut matching its title. Expose the shortcut to the user via an `accessories={[{ tag: "⌘L" }]}` badge — Raycast doesn't surface push shortcuts in the row itself.

## Rule 3: Persistent context per view

Lists and Forms own their top chrome, not their bottom. Set these on every `<List>` / `<Form>` / `<Detail>`:

- `navigationTitle` — what view the user is in (persists in the title bar).
- `searchBarPlaceholder` — doubles as a status line: counts, totals, hints (e.g. `"${count} profile(s) · ${idleCount} idle · ${formatBytes(total)}"`).
- `<List.Item accessories>` — per-row badges for state (`Idle`, `In use`, `Cleans on exit`, size, timestamp).
- `<List.Item subtitle>` — one-line "what this does" description on root menu items.

## Checklist for every new action

When adding any `<Action>`, verify:

- [ ] **Feedback** — does the user see a toast, HUD, or state change that confirms the action ran?
- [ ] **Failure path** — is thrown-error handled with `showFailureToast`?
- [ ] **Shortcut** — does it have `shortcut={...}` (or is it *the* primary ⏎ action)?
- [ ] **Style** — is `Action.Style.Destructive` set on any delete/clear?
- [ ] **Confirmation** — does destructive work go through `confirmAlert` first?
- [ ] **Icon** — is there an `icon={Icon.X}` so the panel reads at a glance?
- [ ] **Quantitative detail** — on bulk ops, does the success toast include count + freed size / affected entries?

## Reference implementations in this repo

- **Animated → Success with freed size**: `raycast/src/profiles/ProfileList.tsx` — `handleDelete`, `handleDeleteAll`
- **HUD for no-view command**: `raycast/src/launch.ts` — `launchWithValues`
- **Form reset via `key` remount**: `raycast/src/options/LaunchOptionsForm.tsx` — `handleReset`
- **Root-list letter-key navigation + `accessories` badges**: `raycast/src/tempchrome.tsx`
- **Quantitative clear feedback**: `raycast/src/options/RecentLaunchesList.tsx` — `handleClear`

## Anti-patterns

- ❌ Silent `await doSomething()` — no toast, no HUD, no state change. User doesn't know it ran.
- ❌ `showToast({ title: "Done" })` with no detail on a destructive / bulk op. Count what changed.
- ❌ Two actions with the same shortcut in one `ActionPanel` — Raycast silently drops one.
- ❌ Using `showToast` in a `no-view` command — the panel is gone before the toast renders. Use `showHUD`.
- ❌ Hand-writing destructive confirm dialogs — always go through `confirmAlert` with `Alert.ActionStyle.Destructive`.
