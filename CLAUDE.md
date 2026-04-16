# CLAUDE.md

## Project Overview

TempChrome is a macOS shell utility that launches Chromium with temporary, isolated user profiles. It supports both Intel (`Mac`) and Apple Silicon (`Mac_Arm`) architectures. The main entry point is `cli/tempchrome.sh`.

## Shell Scripting Conventions

- Use `bash` with `set -euo pipefail` in all new scripts
- Use 2-space indentation
- Use `shellcheck` to validate all `.sh` files before completing work
- Use meaningful variable names — avoid single-letter names except for loop indices
- Use SCREAMING_SNAKE_CASE for constants, snake_case for local variables and functions

## Project Structure

- `tempchrome.sh` — core launcher script (~261 lines)
- `raycast/` — planned Raycast extension (active development target)
- `cli/` — placeholder for future CLI wrapper
- `.claude/skills/` — Claude Code skills (raycast-extension already exists)

## Important Notes

- Use `bun` for JavaScript/TypeScript development (e.g., Raycast extension) to leverage its speed and built-in features
- **macOS-only** — the script uses macOS-specific paths (`/Applications/`, `xattr`, `open`) and architecture detection
- Chromium profiles are created in `/tmp/tempchrome_profile/` with random IDs
- The install target downloads from Google's official Chromium snapshot storage
- `GOOGLE_API_KEY`, `GOOGLE_DEFAULT_CLIENT_ID`, and `GOOGLE_DEFAULT_CLIENT_SECRET` are required for the browser's Google features (e.g., Gemini, sync). These keys originate from **Debian's Chromium package** (not Chromium's source tree — Chromium ships without keys). They are already publicly visible in Debian's package sources, but note that Google's API ToS technically prohibits redistribution. The keys date from 2014 and may be outdated for some services
