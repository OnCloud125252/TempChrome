## MODIFIED Requirements

### Requirement: Chromium binary path preference
The system SHALL read the Chromium binary path from a Raycast extension-level preference named `chromiumPath` with default value `~/Applications/Chromium.app/Contents/MacOS/Chromium`. The `getPreferences()` helper SHALL expand a leading `~` or `~/` in both `chromiumPath` and `tempBaseDir` to the user's home directory (`os.homedir()`) before returning the preference object. All downstream code (launcher, installer, log viewer, profile manager) SHALL receive only absolute paths.

#### Scenario: Default `chromiumPath` resolves under `~/Applications`
- **WHEN** the user has not set `chromiumPath` in Raycast Preferences
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().chromiumPath` SHALL return `/Users/alice/Applications/Chromium.app/Contents/MacOS/Chromium`
- **AND** all Chromium spawn and existence-check operations SHALL use this resolved path

#### Scenario: Custom `chromiumPath` with a leading tilde is expanded
- **WHEN** the user sets `chromiumPath` to `~/bin/chromium-dev/Chromium.app/Contents/MacOS/Chromium`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().chromiumPath` SHALL return `/Users/alice/bin/chromium-dev/Chromium.app/Contents/MacOS/Chromium`

#### Scenario: Absolute `chromiumPath` is passed through unchanged
- **WHEN** the user sets `chromiumPath` to `/Applications/Thorium.app/Contents/MacOS/Thorium`
- **THEN** `getPreferences().chromiumPath` SHALL return `/Applications/Thorium.app/Contents/MacOS/Thorium` unchanged

#### Scenario: `tempBaseDir` tilde expansion
- **WHEN** the user sets `tempBaseDir` to `~/tempchrome`
- **AND** the user's home directory is `/Users/alice`
- **THEN** `getPreferences().tempBaseDir` SHALL return `/Users/alice/tempchrome`
