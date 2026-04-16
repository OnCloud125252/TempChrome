/**
 * Single source of truth for launch options.
 *
 * Both surfaces read from here:
 *   - `Quick Launch TempChrome` — persistent prefs, generated into `package.json`'s
 *     `launch` command via `scripts/sync-options-schema.ts` (auto-runs on lint/dev/build).
 *   - `Launch with Options` form — React form rendered by iterating this schema.
 *
 * The two surfaces hold **independent values** — only the UI definitions and
 * the flag-mapping logic are shared.
 *
 * To add a new option: append an entry to `LAUNCH_OPTIONS_SCHEMA` and extend
 * `LaunchOptionsValues`. That's it — `bun run sync:options` regenerates the
 * manifest, the form auto-renders the new field, and `buildExtraArgs` picks
 * up the new `toArgs` mapping.
 */

type DropdownField = {
  readonly kind: "dropdown";
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly default: string;
  readonly options: readonly {
    readonly title: string;
    readonly value: string;
  }[];
  readonly toArgs: (value: string) => readonly string[];
};

type CheckboxField = {
  readonly kind: "checkbox";
  readonly name: string;
  readonly title: string;
  readonly label: string;
  readonly description: string;
  readonly default: boolean;
  readonly toArgs: (value: boolean) => readonly string[];
};

type TextfieldField = {
  readonly kind: "textfield";
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly default: string;
  readonly placeholder?: string;
  readonly toArgs: (value: string) => readonly string[];
};

export type OptionField = DropdownField | CheckboxField | TextfieldField;

export type LaunchOptionsValues = {
  browsingMode: "normal" | "incognito";
  disableWebSecurity: boolean;
  disableExtensions: boolean;
  autoCleanup: boolean;
  customArgs: string;
};

function parseCustomArgs(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export const LAUNCH_OPTIONS_SCHEMA: readonly OptionField[] = [
  {
    kind: "dropdown",
    name: "browsingMode",
    title: "Browsing Mode",
    description: "Default browsing mode",
    default: "normal",
    options: [
      { title: "Normal", value: "normal" },
      { title: "Incognito", value: "incognito" },
    ],
    toArgs: (value) => (value === "incognito" ? ["--incognito"] : []),
  },
  {
    kind: "checkbox",
    name: "disableWebSecurity",
    title: "Disable Web Security",
    label: "Pass --disable-web-security on launch",
    description: "Disables same-origin policy (use with caution)",
    default: false,
    toArgs: (value) => (value ? ["--disable-web-security"] : []),
  },
  {
    kind: "checkbox",
    name: "disableExtensions",
    title: "Disable Extensions",
    label: "Pass --disable-extensions on launch",
    description: "Start Chromium without any installed extensions",
    default: false,
    toArgs: (value) => (value ? ["--disable-extensions"] : []),
  },
  {
    kind: "checkbox",
    name: "autoCleanup",
    title: "Auto-Cleanup",
    label: "Mark profile for cleanup after Chromium closes",
    description: "Automatically delete the temp profile once the Chromium window is closed",
    default: true,
    // autoCleanup is not a Chromium CLI flag — it drives markForAutoCleanup()
    // in the caller. Kept in the schema so it appears in the shared UI.
    toArgs: () => [],
  },
  {
    kind: "textfield",
    name: "customArgs",
    title: "Custom Chromium Arguments",
    description: "Extra CLI flags appended to every launch (whitespace-separated)",
    default: "",
    placeholder: "--flag1 --flag2=value",
    toArgs: (value) => parseCustomArgs(value),
  },
];

export function buildExtraArgs(values: LaunchOptionsValues): string[] {
  const lookup = values as unknown as Record<string, string | boolean>;
  return LAUNCH_OPTIONS_SCHEMA.flatMap((field) => {
    switch (field.kind) {
      case "dropdown":
        return [...field.toArgs(lookup[field.name] as string)];
      case "checkbox":
        return [...field.toArgs(lookup[field.name] as boolean)];
      case "textfield":
        return [...field.toArgs(lookup[field.name] as string)];
      default:
        return [];
    }
  });
}
