import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { SrneData } from '../models/srne.models';
import { ModbusTcpService } from './modbus-tcp.service';
import { SettingsService } from './settings.service';
import { HistoryService } from './history.service';

// Modbus register addresses — SRNE hybrid inverter (based on srne_asf.yaml from ha-solarman)
// Reference: SRNE Solar Charge Inverter MODBUS Protocol v1.96
const REG_BATTERY_SOC     = 0x0100;  // Battery SoC (%)
const REG_BATTERY_VOLTAGE = 0x0101;  // Battery Voltage (÷100 → V)
const REG_BATTERY_CURRENT = 0x0102;  // Battery Current signed (÷100 → A)
const REG_PV1_VOLTAGE     = 0x0107;  // PV1 Voltage (÷10 → V, scale 0.1)
const REG_PV1_CURRENT     = 0x0108;  // PV1 Current (÷10 → A, scale 0.1)
const REG_PV1_POWER       = 0x0109;  // PV1 Power (W)
const REG_PV_POWER        = 0x010A;  // PV Total Power (W) — primary solar register
const REG_CHARGE_STATE    = 0x0115;  // Charging state
const REG_LOAD_STATUS     = 0x0116;  // Load output on/off
const REG_LOAD_POWER      = 0x021B;  // Load L1 Active Power (W) — in inverter block
const REG_DAILY_GEN       = 0x3200;  // Daily generated (kWh ÷100)

const MOCK_INTERVAL_SEC = 2;

export type ConnectionStatus = 'demo' | 'connecting' | 'live' | 'error';

@Injectable({ providedIn: 'root' })
export class SrneDataService implements OnDestroy {

  private _data$ = new BehaviorSubject<SrneData | null>(null);
  private _connected$ = new BehaviorSubject<boolean>(false);
  private _useMock$ = new BehaviorSubject<boolean>(true);
  private _status$ = new BehaviorSubject<ConnectionStatus>('demo');
  private _lastError$ = new BehaviorSubject<string>('');
  private _lastPollTime$ = new BehaviorSubject<number | null>(null);

  readonly data$ = this._data$.asObservable();
  readonly connected$ = this._connected$.asObservable();
  readonly useMock$ = this._useMock$.asObservable();
  readonly status$ = this._status$.asObservable();
  readonly lastError$ = this._lastError$.asObservable();
  readonly lastPollTime$ = this._lastPollTime$.asObservable();

  private pollSub?: Subscription;
  private pollRunning = false;
  private lastSnapshotMin = -1;
  private mockPhase = 0;

  constructor(
    private modbus: ModbusTcpService,
    private settings: SettingsService,
    private history: HistoryService
  ) {}

  startPolling(): void {
    this.stopPolling();
    if (this.settings.activeDevice) {
      this._status$.next('connecting');
    }
    const sec = this.settings.settings.pollIntervalSec || 5;
    this.pollSub = interval(sec * 1000).subscribe(() => this.poll());
    this.poll(); // immediate first poll
  }

  stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
  }

  restartPolling(): void {
    this.stopPolling();
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  // ── Real device poll ─────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    // Guard: skip if a previous poll is still in progress (dongle can't handle concurrent connections)
    if (this.pollRunning) return;
    this.pollRunning = true;
    try {
      await this.doPoll();
    } finally {
      this.pollRunning = false;
    }
  }

  private async doPoll(): Promise<void> {
    const device = this.settings.activeDevice;
    if (!device) {
      this.emitMock();
      return;
    }

    // Two sequential reads — LSW-5 dongle only handles one TCP connection at a time.
    // ① 0x0100×23 regs — battery (SoC/V/I), PV power (0x010A), charging state
    // ② 0x021B×2 regs — Load L1 Active Power (W) + Apparent Power (VA)
    // ③ 0x3200×4 regs — daily energy totals (optional)
    const regs1 = await this.modbus.readHoldingRegisters(device, REG_BATTERY_SOC, 23);
    if (!regs1) {
      this._lastError$.next(
        `Register read failed: 0x0100×23. ` +
        `Check serial number (${device.serialNumber}), IP (${device.ip}:${device.port}), ` +
        `Slave ID (${device.slaveId}), and WiFi connection.`
      );
      this._connected$.next(false);
      this._useMock$.next(true);
      this._status$.next('error');
      // Keep the last successful live data visible — do NOT replace with mock values.
      if (!this._data$.getValue()) this.emitMock(); // only show mock if there's nothing yet
      return;
    }

    // Short pause to let the dongle close its previous TCP session cleanly
    await new Promise(r => setTimeout(r, 400));

    // Inverter block 0x0213-0x021C (10 regs):
    //   0x0213 = Grid L1 Voltage (÷10 → V)
    //   0x0214 = Grid L1 Current (÷10 → A)
    //   0x021B = Load L1 Active Power (W)  [offset 8]
    //   0x021C = Load L1 Apparent Power (VA) [offset 9]
    const invRegs = await this.modbus.readHoldingRegisters(device, 0x0213, 10);
    if (invRegs) {
      console.log(`[Poll] Grid: 0x0213=${invRegs[0]}(V×10)  0x0214=${invRegs[1]}(A×10)  Load 0x021B=${invRegs[8]}W`);
    } else {
      console.warn('[Poll] Inverter block (0x0213) read returned null');
    }

    // Short pause before the optional daily stats read
    await new Promise(r => setTimeout(r, 400));

    // Daily stats (0x3200) are optional — not all firmware versions support this block.
    // Fall back to zeros rather than failing the whole poll.
    const regs2 = await this.modbus.readHoldingRegisters(device, REG_DAILY_GEN, 4);
    const dailyRegs = regs2 ?? [0, 0, 0, 0];

    this._lastError$.next('');
    this._lastPollTime$.next(Date.now());
    this._connected$.next(true);
    this._useMock$.next(false);
    this._status$.next('live');

    const toSigned16 = (v: number) => v > 0x7FFF ? v - 0x10000 : v;

    // PV Total Power is at 0x010A (index 10 from base 0x0100) — already in block 1, no extra call
    const solarPanelPower = Math.max(0, regs1[REG_PV_POWER - REG_BATTERY_SOC]);
    const pvVoltage = regs1[REG_PV1_VOLTAGE - REG_BATTERY_SOC] / 10;
    const pvCurrent = regs1[REG_PV1_CURRENT - REG_BATTERY_SOC] / 10;
    console.log(`[Poll] Solar: 0x010A=${solarPanelPower}W  PV1 ${pvVoltage}V/${pvCurrent}A`);

    const data: SrneData = {
      batterySoc:        regs1[REG_BATTERY_SOC - REG_BATTERY_SOC],
      batteryVoltage:    regs1[REG_BATTERY_VOLTAGE - REG_BATTERY_SOC] / 10,   // scale 0.1 per SRNE spec
      // SRNE sends positive current when discharging; negate so app convention is negative = discharging
      batteryCurrent:    -toSigned16(regs1[REG_BATTERY_CURRENT - REG_BATTERY_SOC]) / 10,
      batteryTemp:       toSigned16(regs1[0x0103 - REG_BATTERY_SOC]) / 10,
      loadVoltage:       0,
      loadCurrent:       0,
      // 0x021B = Load L1 Active Power (W) per SRNE MODBUS Protocol v1.96
      loadPower:         invRegs ? invRegs[8] : 0,
      // Grid power from 0x0213 (V) × 0x0214 (I), both scale 0.1; positive = importing
      gridPower:         (() => {
        if (!invRegs) return 0;
        const gV = invRegs[0] / 10;
        const gA = invRegs[1] / 10;
        const w = Math.round(gV * gA);
        return w > 5 ? w : 0; // suppress noise/rounding below 5W
      })(),
      solarPanelVoltage: pvVoltage,
      solarPanelCurrent: pvCurrent,
      solarPanelPower:   solarPanelPower,
      chargingState:     regs1[REG_CHARGE_STATE - REG_BATTERY_SOC],
      loadStatus:        regs1[REG_LOAD_STATUS - REG_BATTERY_SOC],
      dailyGenerated:    dailyRegs[0] / 100,
      dailyConsumed:     dailyRegs[1] / 100,
      dailyChargeAh:     dailyRegs[2] / 100,
      dailyDischargeAh:  dailyRegs[3] / 100,
      timestamp:         Date.now()
    };
    this._data$.next(data);
    this.maybeSnapshot(data);
  }

  // ── Mock data generator ──────────────────────────────────────────────────

  private emitMock(): void {
    this.mockPhase += 0.05;
    const hour = new Date().getHours();
    const solarFactor = Math.max(0, Math.sin((hour - 6) * Math.PI / 12));

    const solarPower   = Math.round(300 * solarFactor * (0.85 + 0.15 * Math.sin(this.mockPhase)));
    const loadPower    = Math.round(80 + 40 * Math.sin(this.mockPhase * 0.3));
    const batterySoc   = Math.round(55 + 25 * Math.sin(this.mockPhase * 0.1));
    const batteryV     = parseFloat((12 + batterySoc * 0.026).toFixed(2));
    const netCharge    = solarPower - loadPower;
    const battCurrent  = parseFloat((netCharge / batteryV).toFixed(2));

    const data: SrneData = {
      batterySoc,
      batteryVoltage:    batteryV,
      batteryCurrent:    battCurrent,
      batteryTemp:       28.5,
      solarPanelVoltage: parseFloat((18 + solarFactor * 4).toFixed(2)),
      solarPanelCurrent: parseFloat((solarPower / 18).toFixed(2)),
      solarPanelPower:   solarPower,
      loadVoltage:       batteryV,
      loadCurrent:       parseFloat((loadPower / batteryV).toFixed(2)),
      loadPower,
      gridPower:         0,  // no grid in mock/demo mode
      loadStatus:        1,
      dailyGenerated:    parseFloat((solarFactor * 1.8 + 0.2).toFixed(2)),
      dailyConsumed:     parseFloat((0.5 + this.mockPhase * 0.002).toFixed(2)),
      dailyChargeAh:     parseFloat((solarFactor * 15 + 2).toFixed(1)),
      dailyDischargeAh:  parseFloat((5 + this.mockPhase * 0.01).toFixed(1)),
      timestamp:         Date.now()
    };
    this._data$.next(data);
    this.maybeSnapshot(data);
  }

  private maybeSnapshot(data: SrneData): void {
    const currentMin = Math.floor(data.timestamp / 60_000);
    if (currentMin === this.lastSnapshotMin) return;
    this.lastSnapshotMin = currentMin;
    this.history.addSnapshot({
      timestamp:      data.timestamp,
      solarPower:     data.solarPanelPower,
      loadPower:      data.loadPower,
      batterySoc:     data.batterySoc,
      batteryVoltage: data.batteryVoltage,
      dailyGenerated: data.dailyGenerated,
      dailyConsumed:  data.dailyConsumed
    });
  }
}
