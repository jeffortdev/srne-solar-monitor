import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, interval, Subscription } from 'rxjs';
import { SrneData } from '../models/srne.models';
import { ModbusTcpService } from './modbus-tcp.service';
import { SettingsService } from './settings.service';
import { HistoryService } from './history.service';

// Modbus register base addresses (SRNE HESP4860S100-H via LSW-5 dongle, SolarmanV5 protocol)
const REG_BATTERY_SOC     = 0x0100;
const REG_BATTERY_VOLTAGE = 0x0101;
const REG_BATTERY_CURRENT = 0x0102;
const REG_BATT_TEMP       = 0x0108;
const REG_LOAD_VOLTAGE    = 0x010A;
const REG_LOAD_CURRENT    = 0x010B;
const REG_LOAD_POWER      = 0x010C;
const REG_PV_VOLTAGE      = 0x010D;
const REG_PV_CURRENT      = 0x010E;
const REG_PV_POWER        = 0x010F;
const REG_CHARGE_STATE    = 0x0115;
const REG_LOAD_STATUS     = 0x0116;
const REG_DAILY_GEN       = 0x3200;

const MOCK_INTERVAL_SEC = 2;

export type ConnectionStatus = 'demo' | 'connecting' | 'live' | 'error';

@Injectable({ providedIn: 'root' })
export class SrneDataService implements OnDestroy {

  private _data$ = new BehaviorSubject<SrneData | null>(null);
  private _connected$ = new BehaviorSubject<boolean>(false);
  private _useMock$ = new BehaviorSubject<boolean>(true);
  private _status$ = new BehaviorSubject<ConnectionStatus>('demo');

  readonly data$ = this._data$.asObservable();
  readonly connected$ = this._connected$.asObservable();
  readonly useMock$ = this._useMock$.asObservable();
  readonly status$ = this._status$.asObservable();

  private pollSub?: Subscription;
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
    const device = this.settings.activeDevice;
    if (!device) {
      this.emitMock();
      return;
    }

    // Two sequential batches — LSW-5 dongle only handles one TCP connection at a time.
    // 0x0100-0x0116 (23 regs), then 0x3200-0x3203 (4 regs)
    const regs1 = await this.modbus.readHoldingRegisters(device, REG_BATTERY_SOC, 23);
    if (!regs1) {
      this._connected$.next(false);
      this._useMock$.next(true);
      this._status$.next('error');
      this.emitMock();
      return;
    }

    const regs2 = await this.modbus.readHoldingRegisters(device, REG_DAILY_GEN, 4);
    if (!regs2) {
      this._connected$.next(false);
      this._useMock$.next(true);
      this._status$.next('error');
      this.emitMock();
      return;
    }

    this._connected$.next(true);
    this._useMock$.next(false);
    this._status$.next('live');

    const toSigned16 = (v: number) => v > 0x7FFF ? v - 0x10000 : v;

    const data: SrneData = {
      batterySoc:        regs1[0x0100 - REG_BATTERY_SOC],
      batteryVoltage:    regs1[0x0101 - REG_BATTERY_SOC] / 100,
      batteryCurrent:    toSigned16(regs1[0x0102 - REG_BATTERY_SOC]) / 100,
      batteryTemp:       regs1[0x0108 - REG_BATTERY_SOC] / 100,
      loadVoltage:       regs1[0x010A - REG_BATTERY_SOC] / 100,
      loadCurrent:       regs1[0x010B - REG_BATTERY_SOC] / 100,
      loadPower:         regs1[0x010C - REG_BATTERY_SOC],
      solarPanelVoltage: regs1[0x010D - REG_BATTERY_SOC] / 100,
      solarPanelCurrent: regs1[0x010E - REG_BATTERY_SOC] / 100,
      solarPanelPower:   regs1[0x010F - REG_BATTERY_SOC],
      chargingState:     regs1[0x0115 - REG_BATTERY_SOC],
      loadStatus:        regs1[0x0116 - REG_BATTERY_SOC],
      dailyGenerated:    regs2[0] / 100,
      dailyConsumed:     regs2[1] / 100,
      dailyChargeAh:     regs2[2] / 100,
      dailyDischargeAh:  regs2[3] / 100,
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
      chargingState:     solarPower > 10 ? 1 : 0,
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
