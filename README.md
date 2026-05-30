# SRNE Solar Monitor

A mobile app for monitoring the **SRNE HESP4860S100-H** hybrid inverter via an external SRNE WiFi RS485 dongle.
Built with Ionic + Angular + Capacitor.

## Features

- **Animated Power Flow Diagram** — live SVG animation showing energy flow between solar panel, battery, load, and optional grid
- **Live Stats** — solar power, battery SOC, load power, battery voltage updated every 5–30 seconds
- **Today's Summary** — daily generated kWh, consumed kWh, charged Ah, discharged Ah
- **Reports Tab** — interactive Chart.js bar graphs with toggleable datasets (Solar, Load, SOC, Voltage) for today / 7 days / 30 days
- **Settings Tab** — add SRNE devices by IP or QR code scan, test connection, configure polling interval
- **Demo Mode** — realistic mock data when no device is configured (fully usable without hardware)
- **WCAG 2.1 AA** — accessible SVG, ARIA labels, `prefers-reduced-motion` support, 4.5:1 contrast

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| Ionic CLI | `npm install -g @ionic/cli` |
| Android Studio | Hedgehog or newer |
| Java | 17+ |
| (Optional) Xcode | 15+ for iOS |

---

## Install

```bash
cd C:\POC\srne-solar-monitor
npm install
```

---

## Run in Browser

```bash
npm start
# or: npx ionic serve
```

Opens at http://localhost:8100 — runs in Demo mode (mock data).

---

## Run on Android

```bash
npm run build:prod
npx cap sync
npx cap open android
```

Then press ▶ in Android Studio.

---

## Run on iOS (macOS only)

```bash
npx ionic build --prod
npx cap sync
npx cap open ios
```

---

## Build & Sign APK

### 1. Generate keystore (once)

```bash
npm run keystore:generate
# Follow prompts — remember your keystore password
```

### 2. Build debug APK

```bash
npm run build:apk
```

### 3. Build signed release APK

```bash
npm run build:sign
# You will be prompted for keystore password
```

---

## How to Connect to the HESP4860S100-H

### WiFi Dongle Setup

1. Ensure the external SRNE WiFi RS485 dongle is plugged into the **RS485/Modbus port** of the HESP4860S100-H
2. Power on the inverter — the dongle will broadcast a WiFi hotspot (SSID: `AP_XXXXXX` where XXXXXX is the last 6 digits of its MAC address)
3. Connect your phone to the dongle's WiFi hotspot
4. Open the app → **Settings** tab → **Add Device**
5. Enter:
   - **IP Address**: `192.168.4.1` (default dongle AP IP)
   - **Port**: `8899`
   - **Modbus Slave ID**: `1`
6. Or tap **Scan Dongle QR Code** to scan the QR code printed on the dongle

### Connected to Home WiFi

If you've configured the dongle to join your home network:
- Use the IP assigned by your router (check router admin panel)
- Port remains `8899`

### Supported Model

**SRNE HESP4860S100-H** (48V, 60A MPPT, 100A hybrid inverter) with the external SRNE WiFi RS485 dongle.

---

## Architecture

```
src/app/
├── models/
│   └── srne.models.ts         — SrneData, DeviceConfig, AppSettings interfaces
├── services/
│   ├── modbus-tcp.service.ts  — Modbus RTU over TCP with CRC16 + capacitor-tcp-connect
│   ├── srne-data.service.ts   — Polling service + mock data fallback
│   ├── settings.service.ts    — Device config & app settings (Capacitor Preferences)
│   └── history.service.ts     — Per-minute snapshots + hourly/daily aggregates
├── tab1/                      — Dashboard (animated SVG power-flow diagram)
├── tab2/                      — Reports (Chart.js bar charts)
└── tab3/                      — Settings (device manager, QR scan, preferences)
```

---

## Modbus Register Map (SRNE HESP4860S100-H)

| Register | Description | Scale |
|---|---|---|
| 0x0100 | Battery SOC (%) | ×1 |
| 0x0101 | Battery Voltage | ÷100 = V |
| 0x0102 | Battery Current | ÷100 = A (signed) |
| 0x0108 | Battery Temperature | ÷100 = °C |
| 0x010A | Load Voltage | ÷100 = V |
| 0x010B | Load Current | ÷100 = A |
| 0x010C | Load Power | W |
| 0x010D | Solar Panel Voltage | ÷100 = V |
| 0x010E | Solar Panel Current | ÷100 = A |
| 0x010F | Solar Panel Power | W |
| 0x0115 | Charging State | 0=Idle,1=MPPT,2=Absorb,3=Float,4=Equalise |
| 0x0116 | Load Status | 0=Off,1=On |
| 0x3200 | Daily Generated | ÷100 = kWh |
| 0x3201 | Daily Consumed | ÷100 = kWh |
| 0x3202 | Daily Charge Ah | ÷100 = Ah |
| 0x3203 | Daily Discharge Ah | ÷100 = Ah |

---

## Troubleshooting

**"Could not reach device"** — Ensure your phone is connected to the same WiFi network as the dongle. Test ping from phone.

**Demo mode only** — Go to Settings → Add Device and enter the dongle IP. Demo mode is active when no device is configured or the connection fails.

**Chart shows no data** — Data is collected while the Dashboard tab is open. Leave it open for a few minutes.
