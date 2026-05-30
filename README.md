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

This app uses the **SolarmanV5 protocol** (port 8899) to communicate with the inverter via the **Solarman LSW-5 WiFi data logger dongle**.

### Step 1 — Find Your Logger Serial Number

1. Plug the **LSW-5 dongle** into the RS485 communication port of the HESP4860S100-H
2. Power on the inverter
3. The LSW-5 creates a WiFi hotspot — connect your phone or PC to it
4. Open a browser and go to `http://192.168.10.100` (or the IP shown in the LSW-5 manual)
5. Log in with **username: `admin`** and **password: `admin`** (default)
6. Navigate to **Device Information** and note the **Logger Serial Number** (e.g. `1720747149`)

### Step 2 — Add the Device in the App

1. Ensure your phone is connected to the LSW-5 WiFi hotspot (or the same network as the dongle)
2. Open the app → **Settings** tab → **Add Device**
3. Enter:
   - **IP Address**: `192.168.10.100` (or your dongle’s IP)
   - **Port**: `8899`
   - **Logger Serial Number**: from Step 1 above
   - **Modbus Slave ID**: `1`
   - **Username / Password**: `admin` / `admin` (stored for reference)
4. Or tap **Scan LSW-5 QR Code** — scans the QR on the dongle to auto-fill IP and serial number

### Connected via Home WiFi

If the LSW-5 has been configured to join your home network:
- Use the DHCP-assigned IP (check your router admin panel)
- Port and serial number remain the same

### Supported Model

**SRNE HESP4860S100-H** (48V, 60A MPPT, 100A hybrid inverter) with the **Solarman LSW-5** WiFi data logger dongle.

---

## Architecture

```
src/app/
├── models/
│   └── srne.models.ts         — SrneData, DeviceConfig, AppSettings interfaces
├── services/
│   ├── modbus-tcp.service.ts  — SolarmanV5 protocol wrapper (port 8899) + capacitor-tcp-connect
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

**"No response"** — Ensure your phone is connected to the same WiFi as the LSW-5 dongle. Verify the **Logger Serial Number** is correct (find it in the dongle's web UI at `http://<IP>` → Device Information).

**Wrong serial number** — The SolarmanV5 protocol requires the exact serial number of the LSW-5. An incorrect serial causes silent timeouts. Recheck it on the dongle web interface.

**Demo mode only** — Go to Settings → Add Device and fill in the IP, port (`8899`), and logger serial number. Demo mode is active when no device is configured or the connection fails.

**Chart shows no data** — Data is collected while the Dashboard tab is open. Leave it open for a few minutes.
