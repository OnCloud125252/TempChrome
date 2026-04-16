---
name: ray
description: Run Raycast CLI (`ray`) commands for this project's extension. Use when the user asks to build, develop, lint, publish, log in, or otherwise operate the Raycast extension with `ray` (e.g. "ray build", "start dev", "lint the extension", "publish to Raycast Store").
---

# Ray (Raycast CLI)

The `ray` CLI ships inside `@raycast/api` and drives the extension's lifecycle: dev server, lint, build, publish, auth. It is **not** a globally installed binary — always invoke it via `bun run <script>` or `bunx ray <command>` from inside the extension directory.

## Working Directory — always `$PROJ/raycast`

The extension lives at `$PROJ/raycast/` (not at the repo root). **Every `ray` invocation must run from that directory.** If the shell's cwd is the repo root, either:

```bash
cd raycast && bun run dev          # prefer this
# or
(cd raycast && bunx ray develop)   # subshell, no state drift
```

`ray` resolves `package.json`, `src/`, `assets/`, and `node_modules/` relative to its cwd; running it from the repo root fails with package-not-found errors.

## Always use bun

This project uses **bun** as its package manager and script runner. `npm install`, `npm run *`, `yarn`, and `pnpm` are not supported and must not be introduced. If a task says `npm run X`, translate it to `bun run X`.

## Command Summary

| Script              | Underlying command              | Purpose                                    |
|---------------------|---------------------------------|--------------------------------------------|
| `bun install`       | —                               | Resolve dependencies, write `bun.lock`     |
| `bun run dev`       | `ray develop` (alias `ray dev`) | Live-reload extension in Raycast           |
| `bun run lint`      | `ray lint`                      | Validate manifest, ESLint, Prettier        |
| `bun run lint:fix`  | `ray lint --fix`                | Auto-fix lint/format issues                |
| `bun run build`     | `ray build -e dist -o dist`     | Production build into `raycast/dist/`      |
| `bun run publish`   | `ray publish`                   | Submit extension to Raycast Store          |
| `bunx ray login`    | `ray login`                     | Authenticate with your Raycast account     |
| `bunx ray logout`   | `ray logout`                    | Sign out                                   |
| `bunx ray profile`  | `ray profile`                   | Show logged-in user handle                 |
| `bunx ray migrate`  | `ray migrate`                   | Upgrade to newer Raycast API version       |

## Critical Gotchas

### `ray build -e dist` alone does NOT write `./dist/`

`-e` selects the build **environment** (`dev` | `dist`), not the output path. To emit compiled JS to `raycast/dist/`, include `-o dist`:

```bash
# WRONG — build succeeds but nothing lands in ./dist
bunx ray build -e dist

# RIGHT
bunx ray build -e dist -o dist
```

The project's `build` script already bakes this in.

### `author` must be a registered Raycast Store handle

`ray lint` hits `https://www.raycast.com/api/v1/users/<author>` and fails with a 404 if the handle isn't registered. Symptoms:

```
error  Invalid author "foo". error: 404 - Not found
```

Fix: run `bunx ray login` once to register your handle, then set `"author"` in `package.json` to the exact handle reported by `bunx ray profile`. The field is case-sensitive and is not the same as your git username or email.

### `ray lint --fix` can lowercase proper nouns

The `@raycast/prefer-title-case` rule will "fix" `"TempChrome"` → `"Tempchrome"` and `"Clean Up"` → `"Clean up"`. When the spec mandates exact casing, suppress with a local disable:

```tsx
<Action
  // eslint-disable-next-line @raycast/prefer-title-case
  title="Launch TempChrome"
  onAction={handleLaunch}
/>
```

### `@raycast/api` pins exact peer versions

`@raycast/api@1.104.12` peers `@types/react: 19.0.10` and `@types/node: 22.13.10` as **exact** pins. Using `^18.x` react types triggers:

```
Type 'ReactNode | Promise<ReactNode>' is not assignable to type 'ReactNode'.
  Type 'bigint' is not assignable to type 'ReactNode'.
```

That's React 19's widened `ReactNode` hitting React 18 types. Match the peers exactly.

### React 19 removed the global `JSX` namespace

With `jsx: "react-jsx"` + React 19 types, `function Command(): JSX.Element` fails with `Cannot find namespace 'JSX'`. Import it explicitly:

```tsx
import type { JSX } from "react";
```

## Recipes

### Start dev + auto-reload after build

```bash
cd raycast
bun run dev                           # foreground, hot-reload
# or, one-shot rebuild + reload in Raycast:
bun run build && open "raycast://extensions/raycast/raycast/reload-extensions"
```

### Pre-commit: lint + build

```bash
cd raycast && bun run lint && bun run build
```

Both must exit 0 before pushing.

### Verify lint output is clean

```bash
cd raycast && bun run lint 2>&1 | tail
```

Expected:

```
ready  - validate package.json file
ready  - validate extension icons
ready  - run ESLint
ready  - run Prettier 3.8.3
```

Anything other than four `ready` lines is a regression.

### Check who you're logged in as

```bash
bunx ray profile
```

Use this before editing `package.json`'s `author` field.

## When NOT to use `ray`

- Editing TypeScript sources — use the LSP, not `ray`.
- Running unit tests — Raycast doesn't ship a test runner here. Use `bun test` if tests exist.
- Installing or removing dependencies — use `bun add` / `bun remove`, not anything under `ray`.
