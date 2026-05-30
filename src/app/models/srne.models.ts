export interface SrneData {
  batterySoc: number;        // 0-100 %
  batteryVoltage: number;    // V (×100 raw)
  batteryCurrent: number;    // A (×100 raw, + charging, - discharging)
  batteryTemp: number;       // °C
  solarPanelVoltage: number; // V
  solarPanelCurrent: number; // A
  solarPanelPower: number;   // W
  loadVoltage: number;       // V
  loadCurrent: number;       // A
  loadPower: number;         // W
  chargingState: number;     // 0=idle,1=MPPT,2=absorb,3=float,4=equalize
  loadStatus: number;        // 0=off,1=on
  dailyGenerated: number;    // kWh
  dailyConsumed: number;     // kWh
  dailyChargeAh: number;     // Ah
  dailyDischargeAh: number;  // Ah
  timestamp: number;         // Unix ms
}

export interface DeviceConfig {
  id: string;
  name: string;
  ip: string;
  port: number;
  slaveId: number;
  /** Logger serial number printed on the LSW-5 dongle (also shown in its web UI). Required for the SolarmanV5 protocol. */
  serialNumber: number;
  /** Web-UI username for the LSW-5 dongle (default: admin). Used to retrieve the serial number from the dongle's config page. */
  username?: string;
  /** Web-UI password for the LSW-5 dongle (default: admin). */
  password?: string;
}

export interface AppSettings {
  activeDeviceId: string | null;
  showGrid: boolean;
  darkMode: boolean;
  pollIntervalSec: number; // 5, 10, or 30
}

export interface HistorySnapshot {
  timestamp: number;
  solarPower: number;
  loadPower: number;
  batterySoc: number;
  batteryVoltage: number;
  dailyGenerated: number;
  dailyConsumed: number;
}

export const CHARGING_STATE_LABELS: Record<number, string> = {
  0: 'Idle',
  1: 'MPPT',
  2: 'Absorb',
  3: 'Float',
  4: 'Equalise'
};
