## ADDED Requirements

### Requirement: Each profile list item exposes a "View Log" action
The system SHALL attach a "View Log" `Action.Push` to the `ActionPanel` of every `List.Item` rendered by the Manage Temp Profiles list. The action SHALL push the `LogViewer` component (from the `log-viewer` capability) with `profileDir` set to the absolute path of the profile directory for that row. The action SHALL bind shortcut `{ modifiers: ["cmd"], key: "l" }`.

#### Scenario: Action is present on every row
- **WHEN** the Manage Temp Profiles list renders any `List.Item` for a profile subdirectory
- **THEN** the item's `ActionPanel` SHALL include an `Action.Push` titled `"View Log"` with `icon: Icon.Document` (or the closest equivalent)
- **AND** the action SHALL declare `shortcut={{ modifiers: ["cmd"], key: "l" }}`
- **AND** its `target` prop SHALL be `<LogViewer profileDir={profile.path} />`

#### Scenario: Action is present regardless of whether the log file exists
- **WHEN** the profile directory does not contain a `chrome_debug.log` file (for example, for profiles created before this change shipped)
- **THEN** the "View Log" action SHALL still appear in the ActionPanel
- **AND** selecting it SHALL push the `LogViewer`, which SHALL surface the "No log file found" state per the `log-viewer` capability

### Requirement: "View Log" shortcut is advertised via accessories
The system SHALL add a tag accessory to each profile `List.Item`'s `accessories` array containing `{ tag: "⌘L" }` (in addition to any existing accessories such as in-use status and date). This advertises the shortcut without requiring the user to open the ⌘K action panel.

#### Scenario: Accessory is present
- **WHEN** the Manage Temp Profiles list renders a `List.Item`
- **THEN** the item's `accessories` SHALL include an accessory object `{ tag: "⌘L" }`
- **AND** this accessory SHALL appear in addition to (not replacing) the existing "In use" tag accessory when applicable and the date accessory
