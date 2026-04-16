# Package Structure Reference

Every Raycast extension is a small npm package driven by `package.json` (the manifest) plus a `tsconfig.json` and optional preferences. This reference is **bun-only** — the global TempChrome rule forbids `npm`/`yarn`/`pnpm`.

## `package.json` (opinionated template)

```json
{
  "$schema": "https://www.raycast.com/schemas/extension.json",
  "name": "extension-name",
  "title": "Extension Title",
  "description": "What this extension does",
  "icon": "extension-icon.png",
  "author": "author-name",
  "categories": ["Productivity", "Developer Tools"],
  "license": "MIT",
  "commands": [
    {
      "name": "command-name",
      "title": "Command Title",
      "description": "What this command does",
      "mode": "view",
      "keywords": ["keyword1", "keyword2"]
    }
  ],
  "dependencies": {
    "@raycast/api": "^1.104.12",
    "@raycast/utils": "^1.19.1"
  },
  "devDependencies": {
    "@raycast/eslint-config": "^1.0.11",
    "@types/node": "22.13.10",
    "@types/react": "19.0.10",
    "eslint": "^8.57.0",
    "prettier": "^3.3.3",
    "typescript": "^5.5.4"
  },
  "scripts": {
    "build": "ray build --skip-types -e dist -o dist",
    "dev": "ray develop",
    "lint:fix": "ray lint --fix",
    "lint": "ray lint",
    "publish": "ray publish"
  }
}
```

### Type version pinning (non-obvious footgun)

`@raycast/api@1.104+` declares `@types/react: 19.0.10` and `@types/node: 22.13.10` as **exact** peer deps. Using `^18.x` on `@types/react` will break `ray build` with:

```
Type 'bigint' is not assignable to type 'ReactNode'
```

That is React 19's widened `ReactNode` colliding with React 18 types. Pin exact versions, not ranges.

## Commands

Each command is a file in `src/` matching its `name`.

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Unique identifier (matches filename in `src/`) |
| `title` | Yes | Display name in Raycast |
| `description` | Yes | Shown in the Store and search |
| `mode` | Yes | `"view"`, `"no-view"`, or `"menu-bar"` |
| `subtitle` | No | Secondary text |
| `icon` | No | Command-specific icon |
| `keywords` | No | Additional search terms |
| `interval` | No | Background schedule (`no-view`/`menu-bar` only — see [performance.md](performance.md) for the sidecar pattern) |
| `disabledByDefault` | No | User must enable manually |
| `hotkey` | No | Suggested hotkey (users override in Raycast Preferences) |

### Command modes

| Mode | Use case |
|------|----------|
| `view` | UI with `List`, `Detail`, `Form`, `Grid` |
| `no-view` | Background task, clipboard, notifications only; supports `interval` |
| `menu-bar` | Menu bar icon with dropdown; supports `interval` |

### Hotkey shape

```json
"hotkey": { "modifiers": ["opt"], "key": "m" }
```

Modifiers: `cmd`, `opt`, `ctrl`, `shift`. Values in `package.json` are suggestions — users bind the real hotkey in Raycast Preferences → Extensions.

## Arguments

Prompt the user inline when they invoke the command.

```json
{
  "commands": [
    {
      "name": "search",
      "title": "Search",
      "mode": "view",
      "arguments": [
        { "name": "query", "type": "text", "placeholder": "Search term", "required": true }
      ]
    }
  ]
}
```

| Type | Value type | Description |
|------|------------|-------------|
| `text` | string | Free text input |
| `password` | string | Concealed text |
| `dropdown` | string | Select from `data` options |

```tsx
interface Arguments {
  query: string;
}

export default function Command(props: LaunchProps<{ arguments: Arguments }>) {
  const { query } = props.arguments;
  return <List searchText={query}>{/* ... */}</List>;
}
```

## Preferences

Extension-wide or command-specific settings configured in Raycast.

```json
{
  "preferences": [
    { "name": "apiKey", "type": "password", "required": true, "title": "API Key", "description": "Your API key" },
    {
      "name": "defaultView",
      "type": "dropdown",
      "required": false,
      "title": "Default View",
      "description": "Choose starting view",
      "default": "list",
      "data": [
        { "title": "List View", "value": "list" },
        { "title": "Grid View", "value": "grid" }
      ]
    }
  ]
}
```

| Type | Value | Description |
|------|-------|-------------|
| `textfield` | string | Single-line text |
| `password` | string | Concealed text |
| `checkbox` | boolean | Toggle |
| `dropdown` | string | Select from `data` |
| `appPicker` | `Application` | App selection |
| `file` | string | File path |
| `directory` | string | Directory path |

```tsx
import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  apiKey: string;
  defaultView: "list" | "grid";
}

const { apiKey, defaultView } = getPreferenceValues<Preferences>();
```

See also: [references/api/preferences.md](api/preferences.md).

## `tsconfig.json`

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "allowJs": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "noEmit": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["src/**/*", "raycast-env.d.ts"]
}
```

## `.eslintrc.json`

```json
{ "root": true, "extends": ["@raycast"] }
```

## File Layout

```
my-extension/
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── raycast-env.d.ts        # auto-generated by ray
├── assets/
│   ├── extension-icon.png
│   ├── extension-icon@dark.png
│   └── command-icon.png
└── src/
    ├── command-name.tsx    # matches package.json command name
    └── utils/
        └── api.ts
```

## Icons

Place PNG icons in `assets/`. For dark-mode support, ship both `name.png` and `name@dark.png`.

```tsx
import { Icon, Color, List } from "@raycast/api";

<List.Item icon={Icon.Star} title="Favorite" />
<List.Item icon="my-icon.png" title="Custom" />
<List.Item icon={{ source: Icon.Circle, tintColor: Color.Red }} title="Red" />
```

See also: [references/api/icons-images.md](api/icons-images.md).

## Generating a placeholder icon (ImageMagick)

```bash
convert -size 512x512 xc:'#6366F1' -fill white -gravity center \
  -font Helvetica-Bold -pointsize 280 -annotate +0+20 'M' \
  assets/extension-icon.png
```
