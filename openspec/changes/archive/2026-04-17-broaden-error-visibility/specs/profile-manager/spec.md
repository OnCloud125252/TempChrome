## MODIFIED Requirements

### Requirement: List displays every subdirectory of the temp base directory
The system SHALL, on mount and on every refresh, enumerate subdirectories of `tempBaseDir` and render one `List.Item` per subdirectory. Items SHALL be sorted by `fs.stat.birthtime` descending (newest first). Directory sizes for the `subtitle` accessory SHALL be computed in parallel with a concurrency cap of `4` concurrent `computeDirectorySize` walks, so that a user with many profiles does not wait for sequential disk walks. Stat and walk failures on individual profiles SHALL flow through `reportError(..., { silent: true })` and SHALL cause only the failing profile to be skipped — the remaining profiles SHALL still render.

#### Scenario: Profiles exist
- **WHEN** `tempBaseDir` contains at least one subdirectory
- **THEN** the system SHALL render a `<List>` with one `<List.Item>` per subdirectory
- **AND** each item's `title` SHALL be the directory's basename (the 10-character ID)
- **AND** each item's `subtitle` SHALL be the directory's total recursive size formatted via a humanized size helper (examples: `"892 KB"`, `"12.4 MB"`, `"1.2 GB"`)
- **AND** each item's `accessories` SHALL include `{ date: <birthtime Date> }` showing the directory's creation time
- **AND** items SHALL be sorted by `birthtime` descending

#### Scenario: No profiles exist
- **WHEN** `tempBaseDir` is empty or does not exist
- **THEN** the system SHALL render `<List.EmptyView>` with `title: "No temporary profiles found"` and `description: "Launch TempChrome to create one."`
- **AND** the EmptyView SHALL include a single `Action` titled `"Launch TempChrome"` that performs a quick-launch and triggers a list refresh

#### Scenario: Sizes are computed in parallel
- **WHEN** the list enumerates `N >= 8` profile directories
- **THEN** at most `4` `computeDirectorySize` walks SHALL be in flight at any moment
- **AND** the total wall-clock time for size computation SHALL be bounded by approximately `ceil(N / 4) * median(single-profile walk time)` (not `N * median`)

#### Scenario: A single profile's stat failure does not abort the list
- **WHEN** listing encounters an error other than `ENOENT` while stat'ing one profile directory
- **THEN** the failing profile SHALL be omitted from the rendered list
- **AND** `reportError("Could not read profile directory", error, { silent: true })` SHALL be invoked
- **AND** the remaining profiles SHALL still render
