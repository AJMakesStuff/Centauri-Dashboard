# Changelog

Notable changes to the Centauri Carbon Dashboard are recorded here.

## Unreleased

### Added

- Stop, Play (resume), and Pause buttons for the current print, with command acknowledgement handling and a response timeout.
- Saved visibility switches in Settings for print controls, temperatures, the entire stats panel, and the chamber light button.
- Animated shimmer on the filled progress bar, with support for reduced-motion preferences.
- README covering dashboard features, setup, usage, and troubleshooting.
- This changelog.

### Changed

- Renamed Mainboard ID to Serial Number in settings panel
- Print controls overlay the camera's bottom-right corner in standard view and sit below the LIVE badge with spacing in fullscreen.
- The print-control panel displays only buttons, with command feedback retained for screen readers.
- Play is enabled only for a paused job. Controls are disabled without an active job, while disconnected, or while awaiting a command response; Pause is also disabled while paused or transitioning.
- Renamed Connection settings to Settings and changed its submit button from Connect to Save.
- Moved the chamber light toggle from the temperature panel to a small circular button in the camera's top-right corner.
- In fullscreen, the chamber light button appears directly to the right of Exit fullscreen and returns to the camera corner afterward.
- The stats layout expands job details to use the available width when temperatures are hidden.

### Fixed

- Status parsing accepts additional nested printer message formats.
- Non-status messages no longer clear displayed print information.
- A fullscreen failure no longer resets printer-control connection state.

### Validation

- JavaScript syntax and simulated checks covered print states, command handling, connection guards, and saved visibility preferences.
- Live printer operation has not been verified as part of these changes.
