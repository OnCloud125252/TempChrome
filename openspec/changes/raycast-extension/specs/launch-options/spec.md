## ADDED Requirements

### Requirement: Launch with Options is a push-navigated Form sub-view
The system SHALL expose "Launch with Options…" as a `List.Item` inside the `TempChrome` List command. Triggering its primary action SHALL push a Raycast `Form` component onto the navigation stack using `Action.Push` (or programmatic `useNavigation().push`).

#### Scenario: Navigation to the Form
- **WHEN** the user selects the "Launch with Options…" item in the TempChrome List and triggers its primary action
- **THEN** the system SHALL push a component rendering a `<Form>` onto the navigation stack
- **AND** the Form SHALL be reachable via back-navigation (ESC) back to the TempChrome List

### Requirement: Form renders configurable launch fields in a fixed order
The system SHALL render the following `Form` fields in this exact order, with exactly these `id` values and defaults:

| Order | Component | `id` | Title / Label | Default |
|-------|-----------|----------------|--------------------------------|--------|
| 1 | `Form.Dropdown` | `browsingMode` | "Browsing Mode" | `"normal"` |
| 2 | `Form.Separator` | — | — | — |
| 3 | `Form.Checkbox` | `disableWebSecurity` | "Disable Web Security" | `false` |
| 4 | `Form.Checkbox` | `disableExtensions` | "Disable Extensions" | `false` |
| 5 | `Form.Separator` | — | — | — |
| 6 | `Form.Checkbox` | `autoCleanup` | "Auto-Cleanup After Close" | `true` |
| 7 | `Form.Separator` | — | — | — |
| 8 | `Form.TextField` | `customArgs` | "Custom Arguments" | `""` |

The `browsingMode` Dropdown SHALL have exactly two `Form.Dropdown.Item` entries: `{ value: "normal", title: "Normal" }` and `{ value: "incognito", title: "Incognito" }`. The `customArgs` TextField SHALL have placeholder text `"--flag1 --flag2=value"`.

#### Scenario: Form is rendered with correct defaults
- **WHEN** the user opens the "Launch with Options…" sub-view
- **THEN** the Form SHALL render all eight elements above in order
- **AND** `browsingMode` SHALL have the value `"normal"`
- **AND** `disableWebSecurity` SHALL be unchecked
- **AND** `disableExtensions` SHALL be unchecked
- **AND** `autoCleanup` SHALL be checked
- **AND** `customArgs` SHALL be empty

### Requirement: Form submission builds extra args from field values
On submit, the system SHALL build an `extraArgs: string[]` array from the form values by concatenating, in order:
1. `browsingMode === "incognito"` → push `"--incognito"`
2. `disableWebSecurity === true` → push `"--disable-web-security"`
3. `disableExtensions === true` → push `"--disable-extensions"`
4. Each non-empty token produced by `customArgs.trim().split(/\s+/).filter(Boolean)`

The `extraArgs` array SHALL be appended (in this order) to the base Chromium args `["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=<profileDir>"]` when spawning Chromium.

#### Scenario: Incognito alone
- **WHEN** the user submits with `browsingMode = "incognito"` and all other fields at defaults
- **THEN** `extraArgs` SHALL equal `["--incognito"]`

#### Scenario: Disable Web Security alone
- **WHEN** the user submits with `disableWebSecurity = true` and all other fields at defaults
- **THEN** `extraArgs` SHALL equal `["--disable-web-security"]`

#### Scenario: Disable Extensions alone
- **WHEN** the user submits with `disableExtensions = true` and all other fields at defaults
- **THEN** `extraArgs` SHALL equal `["--disable-extensions"]`

#### Scenario: Custom arguments tokenized by whitespace
- **WHEN** the user submits with `customArgs = "--remote-debugging-port=9222 --proxy-server=socks5://localhost:1080"` and all other fields at defaults
- **THEN** `extraArgs` SHALL equal `["--remote-debugging-port=9222", "--proxy-server=socks5://localhost:1080"]`
- **AND** the raw string SHALL NOT be passed as a single argument

#### Scenario: Leading, trailing, and duplicated whitespace in custom arguments
- **WHEN** the user submits with `customArgs = "   --flag1     --flag2   "`
- **THEN** `extraArgs` SHALL equal `["--flag1", "--flag2"]`
- **AND** empty tokens produced by multiple consecutive whitespace characters SHALL be filtered out

#### Scenario: All flags combined
- **WHEN** the user submits with `browsingMode = "incognito"`, `disableWebSecurity = true`, `disableExtensions = false`, `autoCleanup = true`, `customArgs = "--window-size=1920,1080"`
- **THEN** `extraArgs` SHALL equal `["--incognito", "--disable-web-security", "--window-size=1920,1080"]`
- **AND** the full args passed to `spawn` SHALL be `["--disable-fre", "--no-first-run", "--no-default-browser-check", "--new-window", "--user-data-dir=<profileDir>", "--incognito", "--disable-web-security", "--window-size=1920,1080"]`

### Requirement: Form submission launches Chromium with a fresh temp profile
On submit, the system SHALL perform the same launch sequence as the `quick-launch` capability (create profile, clear quarantine, spawn detached + unref'd), with `extraArgs` appended to the base args.

#### Scenario: Successful form launch
- **WHEN** the user submits the form with valid values
- **AND** the Chromium binary at `chromiumPath` is accessible
- **THEN** the system SHALL create a new profile directory using the same 10-character random-ID + retry logic as `quick-launch`
- **AND** clear quarantine attributes on the Chromium `.app` bundle
- **AND** spawn Chromium with `child_process.spawn` using `detached: true`, `stdio: "ignore"`, the combined args array, and the Google API env vars
- **AND** immediately call `child.unref()`
- **AND** conditionally update the auto-cleanup registry (see separate requirement)
- **AND** invoke the opportunistic sweep as fire-and-forget (see separate requirement)
- **AND** show a HUD (text depends on `autoCleanup` — see HUD requirement)
- **AND** call `useNavigation().pop()` to return to the TempChrome List

#### Scenario: Chromium binary missing on submit
- **WHEN** the user submits the form
- **AND** the file at `chromiumPath` is not accessible
- **THEN** the system SHALL call `showFailureToast` with title `"Chromium not found"` and message `"Run 'Install or Update Chromium' from the TempChrome command to install it."`
- **AND** SHALL NOT create a temp profile directory
- **AND** SHALL NOT spawn Chromium
- **AND** SHALL NOT modify the auto-cleanup registry
- **AND** SHALL NOT pop the navigation stack (user stays on the Form)

### Requirement: Auto-cleanup checkbox updates the LocalStorage registry
When `autoCleanup` is `true` at submission, the system SHALL add the new profile path to the auto-cleanup registry in `LocalStorage` under key `"tempchrome.auto-cleanup-registry"`. When `autoCleanup` is `false`, the system SHALL NOT modify the registry.

The registry's shape SHALL be `Record<string, number>` (profile absolute path → creation timestamp in ms since epoch). The registry SHALL be stored as a JSON string.

#### Scenario: Auto-cleanup enabled
- **WHEN** the user submits with `autoCleanup = true`
- **THEN** the system SHALL read the current registry via `LocalStorage.getItem("tempchrome.auto-cleanup-registry")`
- **AND** parse it as JSON; treat missing, empty, or invalid JSON as an empty object `{}`
- **AND** set `registry[<newProfilePath>] = Date.now()`
- **AND** write the updated registry back via `LocalStorage.setItem("tempchrome.auto-cleanup-registry", JSON.stringify(registry))`

#### Scenario: Auto-cleanup disabled
- **WHEN** the user submits with `autoCleanup = false`
- **THEN** the system SHALL NOT read or modify the auto-cleanup registry

### Requirement: HUD text reflects the auto-cleanup state
The HUD shown after a successful form launch SHALL differ depending on the `autoCleanup` field value.

#### Scenario: HUD with auto-cleanup enabled
- **WHEN** the form submits successfully with `autoCleanup = true`
- **THEN** the system SHALL call `showHUD("Launched (auto-cleanup enabled)")`

#### Scenario: HUD with auto-cleanup disabled
- **WHEN** the form submits successfully with `autoCleanup = false`
- **THEN** the system SHALL call `showHUD("Launched")`

### Requirement: Form launch triggers the opportunistic auto-cleanup sweep
After Chromium is spawned from the Form, the system SHALL invoke the same fire-and-forget sweep described in the `quick-launch` capability. The sweep SHALL run regardless of whether `autoCleanup` was enabled for this launch.

#### Scenario: Sweep runs after Form launch
- **WHEN** the form submits successfully and Chromium is spawned
- **THEN** the system SHALL invoke the sweep as a non-awaited async call
- **AND** the command SHALL `showHUD` and `pop` without waiting for the sweep to finish
- **AND** any error thrown by the sweep SHALL be swallowed and SHALL NOT affect the HUD or pop
