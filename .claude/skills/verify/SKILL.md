---
name: verify
description: Run shellcheck on all shell scripts in the project to catch issues.
---

# Verify

Run shellcheck on all `.sh` files in the repository to catch syntax errors, common pitfalls, and style issues.

## Steps

1. Find all `.sh` files in the repository root (excluding node_modules, .git, and other common ignore directories)
2. Run `shellcheck` on each file:
   ```bash
   find . -name '*.sh' -not -path './.git/*' -not -path './node_modules/*' | xargs shellcheck
   ```
3. Report results clearly — list each file and whether it passed or failed
4. If there are issues, fix them and re-run until all files pass
