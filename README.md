# Boardroom

Boardroom is a local desktop app for managing ESP32 devices on the same Wi-Fi network. It provides a dashboard for device status, GPIO control, telemetry, logs, and OTA firmware uploads after each ESP32 has been flashed once over USB with the Boardroom agent firmware.

The app is local-only. It does not use accounts, cloud sync, or internet-hosted services.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Arduino CLI or Arduino IDE
- ESP32 Arduino core installed
- An ESP32 board connected over USB for the first flash
- A Wi-Fi network shared by the computer and ESP32

## Project Structure

```text
Boardroom/
  electron/
    main.mjs
    preload.cjs
  src/
    main.tsx
    styles.css
  firmware/
    boardroom-esp32-agent/
      boardroom-esp32-agent.ino
  README.md
```

## Run the Desktop App

Install dependencies:

```bash
npm install
```

Start the Electron desktop app with the Vite dev server:

```bash
npm run dev
```

Build the renderer:

```bash
npm run build
```

Run the built app:

```bash
npm start
```

The Electron main process starts a local backend on `http://127.0.0.1:8765` by default. You can override it before launch:

```bash
BOARDROOM_BACKEND_PORT=8770 npm run dev
```

## First USB Flash

OTA cannot work on a stock ESP32. First install the Boardroom agent over USB.

1. Open `firmware/boardroom-esp32-agent/boardroom-esp32-agent.ino`.
2. Set `WIFI_SSID` and `WIFI_PASSWORD` near the top of the sketch.
3. Select an ESP32 board and an OTA-capable partition scheme.
4. Upload the sketch over USB.
5. Open the serial monitor at `115200` baud and note the printed IP address.

Arduino CLI example:

```bash
arduino-cli core install esp32:esp32
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/boardroom-esp32-agent
arduino-cli upload -p /dev/cu.usbserial-0001 --fqbn esp32:esp32:esp32 firmware/boardroom-esp32-agent
```

Replace the serial port with the port shown by:

```bash
arduino-cli board list
```

## Add a Device by IP

1. Start Boardroom with `npm run dev`.
2. In the top bar, enter the ESP32 IP address printed in the serial monitor.
3. Click `Add IP`.
4. Boardroom calls `GET /api/info`, `GET /api/gpio`, and `GET /api/logs`.

Saved devices remain in local browser storage. Online/offline status is refreshed by probing the ESP32 HTTP API.

## Discovery

The v1 app supports manual IP entry and subnet scanning with ranges like:

```text
192.168.1.1-254
```

The firmware advertises an mDNS service named `_boardroom._tcp` and a hostname like:

```text
boardroom-esp32-xxxx.local
```

Automatic mDNS browsing is left as a future enhancement because cross-platform mDNS in Electron usually needs additional native packaging work. The code keeps discovery isolated in the Electron main process so that mDNS browsing can be added without rewriting the UI.

## GPIO Control

The default GPIO pins are:

```text
2, 4, 5, 12, 13
```

You can edit the pin list in Settings. The firmware only accepts pins listed in `GPIO_PINS`; update the sketch if you need a different fixed pin set on the ESP32.

## Build a `.bin`

Use Arduino CLI to compile the agent:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32 --output-dir firmware/boardroom-esp32-agent/build firmware/boardroom-esp32-agent
```

The firmware binary is written under:

```text
firmware/boardroom-esp32-agent/build/
```

Choose the generated `.bin` file in the Boardroom OTA view.

## OTA Upload

Boardroom uploads a multipart `POST /update` request to the selected ESP32. The ESP32 writes the received binary using the Arduino `Update` API, returns a success or failure response, and reboots after a successful update.

The OTA screen intentionally repeats the USB-first requirement: wireless upload only works after the Boardroom agent firmware is already installed.

## ESP32 HTTP API

The firmware exposes:

- `GET /api/info` returns device name, firmware version, chip ID, uptime, RSSI, free heap, and IP address.
- `GET /api/gpio` returns configured pin states.
- `POST /api/gpio` accepts `{ "pin": number, "value": 0 | 1 }`.
- `GET /api/logs` returns recent in-memory logs.
- `POST /update` accepts a firmware binary upload and performs OTA update.

CORS headers are enabled for local app development.

## OTA Partition Layout

Use an ESP32 partition scheme with OTA slots, such as a default OTA app layout in Arduino IDE. If the selected partition scheme has only one app slot or the firmware image is too large for the OTA slot, `/update` will fail.

## Troubleshooting

- `Device did not respond`: confirm the computer and ESP32 are on the same Wi-Fi network and that the IP address is correct.
- `CORS` errors in browser-only preview: run the Electron app so the local backend can perform device calls, or confirm the firmware is running this agent with CORS headers.
- `Upload failed`: check that the target is online, the selected file is a valid ESP32 `.bin`, and the board has an OTA partition scheme.
- ESP32 never appears online: open serial monitor at `115200` baud and verify Wi-Fi connection messages.
- Wrong IP: rebooting or reconnecting to Wi-Fi can change the ESP32 IP unless your router reserves it.
- Firewall issues: allow local network access for Electron/Node on macOS if prompted.
- OTA succeeds but device does not return: wait for reboot, then refresh. If it still fails, reconnect USB serial and inspect boot logs.

## Current Limitations

- Automatic mDNS browsing is not implemented in v1; the firmware advertises `_boardroom._tcp`, and the app supports manual IP plus subnet scan.
- GPIO pin configuration in the app must match the fixed `GPIO_PINS` list compiled into firmware.
- Firmware compilation was designed for the ESP32 Arduino core and does not target ESP8266 or non-Arduino frameworks.
