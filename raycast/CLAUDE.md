# TempChrome (Raycast)

> **Icon note**: The final icon should be an indigo (`#4F46E5`) background with a white globe+stopwatch glyph, 512×512 PNG. A solid-color PNG placeholder is acceptable until the final art is ready. Place the file at `raycast/assets/icon.png`.

Raycast extension for launching Chromium with temporary, isolated profiles. Two top-level commands:

- **Launch TempChrome** (`no-view`) — creates a fresh temp profile, spawns Chromium, shows a HUD. Bind to a hotkey for one-keystroke launch.
- **TempChrome** (`view`) — root List routing to Launch Now, Launch with Options…, Manage Temp Profiles…, and Install or Update Chromium….

The Install action delegates to the `tempchrome` CLI via Terminal.app — install the CLI first (see the root project `README.md`).

## Development

This extension uses [Bun](https://bun.sh) as its package manager and runner. npm is not supported.

```sh
bun install        # install dependencies
bun run dev        # ray develop — live-reload in Raycast
bun run lint       # ray lint — validate package.json, ESLint, Prettier
bun run lint:fix   # ray lint --fix
bun run build      # ray build -e dist
bun run publish    # ray publish (requires a registered Raycast Store handle)
```

## Preferences

Extension-level (shared by all commands, top section of the Raycast prefs pane):

- **Chromium Path** — absolute path to the Chromium binary (default `/Applications/Chromium.app/Contents/MacOS/Chromium`).
- **Temp Profile Base Directory** — where temp profiles are created (default `/tmp/tempchrome_profile`).

Launch options (5 fields: `browsingMode`, `disableWebSecurity`, `disableExtensions`, `autoCleanup`, `customArgs`) are defined once in `src/launchOptionsSchema.ts` and surfaced in **two independent places**:

- **Quick Launch TempChrome** command-level prefs — rendered by Raycast in the prefs pane, persistent across runs. Generated into `package.json` by `scripts/sync-options-schema.ts`; **do not hand-edit** the `launch.preferences` block in package.json.
- **Launch with Options** form (inside the `tempchrome` view command) — React `<Form>` built by iterating `LAUNCH_OPTIONS_SCHEMA`. Values reset to schema defaults every time the form opens; submit values do not write back to the prefs pane.

The two surfaces share the **same UI definitions and the same flag-mapping** (`buildExtraArgs` in the schema module), but hold **independent values**.

### Adding / editing a launch option

1. Edit `src/launchOptionsSchema.ts` — append / modify a `LAUNCH_OPTIONS_SCHEMA` entry and, if the value shape changes, update the `LaunchOptionsValues` type.
2. Run any of `bun run dev` / `bun run lint` / `bun run lint:fix` / `bun run build` — the `pre-` hooks automatically invoke `bun run sync:options`, which rewrites `launch.preferences` in package.json. `ray lint` then regenerates `raycast-env.d.ts` so the TS types line up.
3. The React form picks up the new field on next render (no manual JSX change needed).
