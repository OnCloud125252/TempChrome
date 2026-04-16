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
bun run fix-lint   # ray lint --fix
bun run build      # ray build -e dist
bun run publish    # ray publish (requires a registered Raycast Store handle)
```

## Preferences

- **Chromium Path** — absolute path to the Chromium binary (default `/Applications/Chromium.app/Contents/MacOS/Chromium`).
- **Temp Profile Base Directory** — where temp profiles are created (default `/tmp/tempchrome_profile`).
