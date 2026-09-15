# Changelog

Notable changes to the Centauri Carbon Dashboard are recorded here.

## 0.4.1 (Current)

### Changed

- Minor text change in settings panel

## 0.4.0

### Added

- Redesigned new desktop Fullscreen layout with toggle in settings to switch between current and redesigned layout
- Added toggle in settings for disabling changes of temperature and fans during a print

### Changed

- Implemented settings button back into Fullscreen mode
- Placed the chamber light toggle to the left of the Fullscreen buttons

### Removed

- Print control, temp control, and stats control toggles in settings. All panels are now constantly visible.

## 0.3.0

### Added

- Mobile specific layout

## 0.2.1

### Fixed

- LIVE badge in Fullscreen was covered by controls panel

## 0.2.0

## Added

- Added temperature/fan controls panel options

## Changed

- Increased transparency on print controls panel

## 0.1.9

## Added

- Added split view for monitoring CC1 and CC2 simultaneously
- Added Serial Number auto-discovery error message when running without docker

## 0.1.8

## Fixes

- CC1 Serial Number auto-discovery not functioning periodically

## 0.1.7

- Implemented EricReiche's nginx Docker Compose setup https://github.com/AJMakesStuff/Centauri-Dashboard/pull/1#issue-5446903916

## 0.1.6

### Added

- Implemented EricReiche's CC1 Serial Number auto discovery https://github.com/AJMakesStuff/Centauri-Dashboard/pull/2#issue-5446904148

## 0.1.5

### Added

- Added panel collapse toggles whilst in fullscreen

### Changed

- Changed print control icons

## 0.1.4

### Added

- Added ability to toggle between CC1 and CC2 if both printers are linked

### Fixed

- LAN only access code not visible while typing

### Changed

- Converted print controls to icon only

## 0.1.3

### Fixed

- localhost camera not showing when connecting via Xampp

## 0.1.2

### Added

- CC1/CC2 model selector and saved CC2 LAN access code.
- CC2 MQTT over WebSocket connection with authentication, registration, keepalives, request spacing, and reconnect cleanup.
- CC2 status, temperatures, camera, light, and pause/stop/resume support, including partial status updates and native progress/time estimates.
- Locally bundled MQTT.js 5.14.1 with its MIT license.
- Simulated protocol regression checks for CC1 and CC2. Live CC2 hardware verification remains outstanding.

### Fixed

- Custom camera URLs retain precedence over printer-reported URLs.
- Missing temperatures no longer render as zero degrees.
- Pause stays disabled during resuming.

## 0.1.1

### Changed

- Removed the Fullscreen and Settings text and replaced with icons
- Removed Cancel button and replaced with close icon on Settings panel

## 0.1.0

### Added

- Stop, Play (resume), and Pause buttons for the current print, with command acknowledgement handling and a response timeout.
- Saved visibility switches in Settings for print controls, temperatures, the entire stats panel, and the chamber light button.
- Animated shimmer on the filled progress bar, with support for reduced-motion preferences.
- README covering dashboard features, setup, usage, and troubleshooting.
- This changelog.

### Changed

- Changed text in dashboard GUI
- Renamed all files and browser cache
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
