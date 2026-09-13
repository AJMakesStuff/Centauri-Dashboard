# Centauri Carbon Dashboard

A lightweight, browser-based dashboard for monitoring a Centauri Carbon 3D printer on your local network. It connects directly to the printer using SDCP over WebSocket and displays its camera feed alongside live print information.

The project uses plain HTML, CSS, and JavaScript. There is no build step, package installation, application backend, or cloud account required.

## Features

- Live printer camera view, with an optional custom camera URL.
- Current print filename, progress bar, and percentage calculated from reported print ticks.
- Current and total layers, estimated time remaining, and estimated finish time.
- Current nozzle, bed, and chamber temperatures, plus nozzle and bed targets.
- Chamber light toggle while connected.
- Fullscreen camera view with a print-status and temperature overlay.
- Automatic reconnection with retry delays increasing from 1.5 seconds to a maximum of 30 seconds, plus a manual refresh button.
- Responsive dark interface and connection settings saved in the current browser.
- Print control buttons.

The compact print-control panel can stop, pause, and resume the current print. Play resumes a paused job; it does not start a new file. Play is enabled only for a paused job. All buttons are disabled without an active job, while disconnected, or while awaiting a command response. Pause is disabled while paused or transitioning. Settings includes switches for print controls, temperatures, and the entire stats panel that immediately save visibility in this browser. Hiding the stats panel hides job details and temperatures while keeping the camera buttons independent; the temperature preference is retained when the stats panel is shown again. Controls overlay the bottom-right corner of the camera in standard view and sit below LIVE with extra spacing in fullscreen. It does not currently upload files, start new prints, or change temperature targets.

Print controls use commands 129 (pause), 130 (stop), and 131 (resume), as documented in the [Centauri Carbon API reference](https://docs.opencentauri.cc/software/api/#print-control-commands).

## Requirements

- A powered-on Centauri Carbon printer reachable from your computer over the local network.
- The printer's LAN IP address and Mainboard ID.
- A printer interface that exposes the SDCP WebSocket endpoint and camera stream used below. Compatibility depends on the printer's firmware and available services.

## Setup

- Download or copy the project files into one folder.
- Open centauri-dashboard.html in your browser.
- In **Settings**, enter:
   - Printer IP address: The printer's LAN address, such as `192.168.1.50`, without a URL scheme or port.
   - Mainboard ID: The printer's Mainboard ID obtained from its interface or SDCP discovery. The dashboard does not discover this automatically.
   - Camera URL: Optional full HTTP camera URL. Leave blank to try the default stream.
- Select **Save**. The dashboard saves your settings and attempts to load printer status and the camera. On later visits from the same browser and site address, it reconnects using those saved settings.

## Using the dashboard

- Select **Fullscreen** for a larger camera view. Select **Exit fullscreen** or press `Esc` to leave it.
- Select the refresh arrow beside the connection indicator to reconnect manually.
- Select the circular bulb button in the camera's top-right corner to toggle the chamber light. Use **Show chamber light button** in Settings to hide or show it independently of the stats panel.
- Open **Settings** to change the printer address, Mainboard ID, or camera URL.
- When there is no active print, the job panel shows a waiting message while temperature readings can still update.

## Connection details and storage

The browser connects directly to these printer endpoints:
- SDCP status and commands: `ws://<printer-ip>:3030/websocket`
- Camera: `http://<printer-ip>:3031/video`

The application requests status, attributes, and camera activation when the socket opens, and sends a heartbeat every 15 seconds. A camera URL returned by the printer takes precedence over the initially selected default or custom URL.

Settings are stored in browser local storage under `centauri-dashboard`. To reset them, clear this site's local storage using your browser's developer tools or site-data settings. Using a different browser, hostname, or port creates a separate set of stored settings.

## Troubleshooting

- Cannot connect or repeatedly reconnects: Confirm the printer is powered on, the IP and Mainboard ID are correct, and your computer can reach the printer. Check that firewall rules or network isolation do not block port 3030.
- Connected but no useful status: Verify the Mainboard ID and that the printer firmware provides the expected SDCP status fields. Inspect the browser console and WebSocket traffic for details.
- Camera is unavailable: Confirm the printer camera is enabled. Try opening `http://<printer-ip>:3031/video` directly and check port 3031 access. Enter a custom camera URL if needed.
- LIVE badge appears but camera does not load: The badge reflects the WebSocket connection, not a separate camera health check. Check the camera endpoint independently.
- Chamber light does not respond: The control requires an active connection and firmware support for the SDCP light command. The button updates immediately; a later status message supplies the printer's reported light state.
- Progress or finish time looks inaccurate: These values are estimates calculated from the printer's reported ticks, rather than independent measurements.

## Credits

Made with love by A.J. Richardson.
