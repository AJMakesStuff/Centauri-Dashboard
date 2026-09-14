# Centauri Carbon Dashboard

A lightweight, browser-based dashboard for monitoring a Centauri Carbon or Centauri Carbon 2 3D printer on your local network. CC1 uses SDCP over WebSocket; CC2 uses authenticated JSON-RPC over MQTT over WebSocket. Both display the camera alongside live print information.

The project uses plain HTML, CSS, and JavaScript. There is no build step, package installation, application backend, or cloud account required.

CC2 support includes the existing dashboard features: camera, progress, layers, remaining time, temperatures, chamber light, and pause/stop/resume. It does not add Canvas tray management or file uploads. CC2 compatibility has been checked against protocol sources and simulated messages, but has not yet been verified on a physical printer.

## Screenshots

<img width="1920" height="1080" alt="1" src="https://github.com/user-attachments/assets/5f9116a4-0401-4e3d-af6e-c83643bb0985" />
<img width="1920" height="1080" alt="2" src="https://github.com/user-attachments/assets/688023b5-ed22-4d03-836e-7c3f0913b2ad" />
<img width="1920" height="1080" alt="3" src="https://github.com/user-attachments/assets/8c740b2a-e044-4361-b17d-48dbf78bd263" />

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

CC1 print controls use commands 129 (pause), 130 (stop), and 131 (resume), as documented in the [Centauri Carbon API reference](https://docs.opencentauri.cc/software/api/#print-control-commands). CC2 uses methods 1021, 1022, and 1023, respectively.

## Requirements

- A powered-on CC1 or CC2 reachable over the local network.
- CC1: printer LAN IP address. The Serial Number is optional; the dashboard reads it from the printer by itself.
- CC2: printer LAN IP address, printer serial number (SN), and LAN access code from its touchscreen. Enable **LAN Only** mode.
- Firmware exposing the model's WebSocket endpoint and camera stream below. CC2 requires MQTT over WebSocket on port 9001; a TCP-only MQTT endpoint on port 1883 cannot be used directly by a browser.

## Setup

- Download or copy the project files, including `cc2.js` and the `vendor` folder, into one folder.
- Open dashboard.html in your browser.
- In **Settings**, enter:
   - Printer model: **Centauri Carbon (CC1)** or **Centauri Carbon 2 (CC2)**. Existing settings default to CC1.
   - Printer IP address: The printer's LAN address, such as `192.168.1.50`, without a URL scheme or port. On CC1, editing this field starts looking for the printer's ID right away; the spinner in the Serial Number field shows it working, and the ID appears there before you save.
   - Serial Number: For CC1, leave this **blank** and the dashboard reads the printer's ID from the connection and saves it. Enter it manually (the printer shows it in its interface, or use SDCP discovery) if you prefer. The printer only announces the ID while it is idle or printing, so a paused or stopped printer needs the manual value. For CC2, the SN is required: it forms part of the MQTT topic.
   - LAN access code (CC2 only): The code shown on the printer touchscreen.
   - Camera URL: Optional full HTTP camera URL. Leave blank to try the default stream.
- Select **Save**. The dashboard saves your settings and attempts to load printer status and the camera. On later visits from the same browser and site address, it reconnects using those saved settings. On CC1 with the Serial Number left blank, the dialog stays open with a spinner in that field while the printer's ID is read, then closes on its own once it arrives.

## Run with Docker (optional)

The dashboard is static files, so any web server works. If you would rather not set one up by hand:

```bash
docker compose up -d
```

Then open <http://localhost:8080>.

This runs `nginx:alpine` with the project folder mounted read-only. `nginx.conf` serves `dashboard.html` at `/`, disables directory listings, sends `Cache-Control: no-cache` for the application files so a stale page never pairs with a newer `dashboard.js`, and refuses requests for dotfiles such as `.git`.

Notes:

- The host port is **8080**, not 80, to avoid colliding with anything already listening on port 80 (XAMPP, for example). Change the left side of `"8080:80"` in `docker-compose.yml` for a different port.
- Keep it on plain HTTP. The printer endpoints are `ws://` and `http://`, so an HTTPS origin causes mixed-content failures.
- The container does not need to reach the printer. The browser connects to the printer directly; the container only serves files.
- Stop it with `docker compose down`.
- On an SELinux host (Fedora, RHEL), append `:z` to both volume mounts.

## Using the dashboard

- Select **Fullscreen** for a larger camera view. Select **Exit fullscreen** or press `Esc` to leave it.
- Select the refresh arrow beside the connection indicator to reconnect manually.
- Select the circular bulb button in the camera's top-right corner to toggle the chamber light. Use **Show chamber light button** in Settings to hide or show it independently of the stats panel.
- Open **Settings** to configure each printer and select **Save** for each model. CC1 and CC2 retain separate addresses, IDs, access codes, and camera URLs. Once both are configured, use the **CC1 / CC2** buttons in the dashboard header (also available in fullscreen) to switch the camera, status, and controls. The selected printer is remembered on reload; only the selected printer is connected at a time. The LAN access code is visible as you type.
- When there is no active print, the job panel shows a waiting message while temperature readings can still update.

## Connection details and storage

The browser connects directly to these printer endpoints:

- Status and commands:
   - CC1: `ws://<printer-ip>:3030/websocket` (SDCP) 
   - CC2; `ws://<printer-ip>:9001/mqtt` (MQTT 3.1.1)
- Camera:
   - CC1: `http://<printer-ip>:3031/video`
   - CC2: `http://<printer-ip>:8080/?action=stream`
- Authentication:
   - CC1: None
   - CC2: Username `elegoo`, password = LAN access code

The application requests status, attributes, and camera information on connection, and sends a heartbeat every 15 seconds. On a CC1 connection with no stored Serial Number, it waits for the printer's own status or attribute frame first, reads the ID from that frame, and only then requests anything. CC2 first subscribes and registers its client, spaces API requests at least 2.2 seconds apart, merges partial status updates, and polls full status during heartbeats. CC2 progress and remaining time use the printer's reported values. A camera URL returned by the printer replaces the default only when no custom override is set. Commands queued for CC2 are discarded on disconnect and never replayed after reconnection.

Settings are stored in browser local storage under `dashboard`, including the CC2 access code and any detected CC1 Serial Number in plain text. They are sent only to the configured printer. To reset them, clear this site's local storage using your browser's developer tools or site-data settings. Using a different browser, hostname, or port creates a separate set of stored settings.

## Troubleshooting

- Settings opens by itself saying no printer ID arrived: for CC1 the Serial Number is filled in automatically, but the printer only announces it while it is idle or printing. Wake the printer and reconnect, or paste the Serial Number from its interface.
- CC2 cannot connect: Enable LAN Only mode, verify the printer SN and access code, and check access to port 9001. Authentication and registration failures appear in the connection status. If firmware does not expose MQTT over WebSocket, this browser-only dashboard cannot connect through port 1883 instead.
- Browser blocks local connections: Open the local HTML file or serve it over local HTTP, and allow local-network access when the browser prompts. An HTTPS-hosted page may block the printer's insecure WebSocket and HTTP camera.
- CC2 camera unavailable: Try `http://<printer-ip>:8080/?action=stream` directly, or supply a custom camera URL.
- Cannot connect or repeatedly reconnects: Confirm the printer is powered on, the IP and Serial Number are correct, and your computer can reach the printer. Check that firewall rules or network isolation do not block port 3030.
- Connected but no useful status: Verify the Serial Number and that the printer firmware provides the expected SDCP status fields. Inspect the browser console and WebSocket traffic for details.
- Camera is unavailable: Confirm the printer camera is enabled. Try opening `http://<printer-ip>:3031/video` directly and check port 3031 access. Enter a custom camera URL if needed.
- LIVE badge appears but camera does not load: The badge reflects the WebSocket connection, not a separate camera health check. Check the camera endpoint independently.
- Chamber light does not respond: The control requires an active connection and firmware support for the model's light command (CC1 403; CC2 1029). The button updates immediately; a later status message supplies the printer's reported light state.
- Progress or finish time looks inaccurate: These values are estimates calculated from the printer's reported ticks, rather than independent measurements.

## Credits

Made with love by A.J. Richardson.

- CC2 protocol references: [Elegoo's official SDK](https://github.com/elegooofficial/elegoo-link/tree/main/src/lan/adapters/elegoo_fdm_cc2)
- [CC2 field notes](https://github.com/bjan/pycentauri/blob/main/docs/PROTOCOL.md#centauri-carbon-2-cc2-protocol-notes)
- [browser MQTT port documentation](https://github.com/lantern-eight/elegoo-printer-proxy#how-it-works).

The local `vendor/mqtt.min.js` browser bundle is [MQTT.js](https://github.com/mqttjs/MQTT.js), pinned to 5.14.1, obtained from `https://unpkg.com/mqtt@5.14.1/dist/mqtt.min.js`. Its MIT license is included in `vendor/MQTT-LICENSE.md`. No CDN is contacted at runtime.

## Development checks

With Node.js installed, run `node --test tests/protocol.test.cjs`. Tests simulate both transports, registration/authentication failures, command acknowledgements, partial updates, terminal states, camera overrides, and reconnect cleanup. They do not contact a printer or actuate hardware.

## Disclaimer
This project was developed through a combination of human-written code and AI-assisted development.