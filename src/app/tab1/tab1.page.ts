import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { SrneData, CHARGING_STATE_LABELS } from '../models/srne.models';
import { ConnectionStatus, SrneDataService } from '../services/srne-data.service';
import { SettingsService } from '../services/settings.service';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page implements OnInit, OnDestroy {

  data: SrneData | null = null;
  connected = false;
  status: ConnectionStatus = 'demo';
  errorDetail = '';
  lastUpdated: string = '';
  showGrid = false;

  private subs: Subscription[] = [];
  private lastStatus: ConnectionStatus = 'demo';

  constructor(
    private srne: SrneDataService,
    private settings: SettingsService,
    private toastCtrl: ToastController
  ) {}

  ngOnInit(): void {
    this.showGrid = this.settings.settings.showGrid;
    this.subs.push(
      this.srne.data$.subscribe(d => this.data = d),
      this.srne.connected$.subscribe(c => this.connected = c),
      this.srne.lastError$.subscribe(e => this.errorDetail = e),
      this.srne.lastPollTime$.subscribe(t => {
        this.lastUpdated = t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
      }),
      this.srne.status$.subscribe(s => {
        this.status = s;
        if (s !== this.lastStatus) {
          this.onStatusChange(s);
          this.lastStatus = s;
        }
      })
    );
  }

  ionViewWillEnter(): void {
    this.showGrid = this.settings.settings.showGrid;
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  private async onStatusChange(s: ConnectionStatus): Promise<void> {
    // Only show toasts for meaningful transitions, not the initial 'demo' state
    if (s === 'live') {
      const t = await this.toastCtrl.create({ message: '✓ Connected — live data active', duration: 2500, color: 'success', position: 'bottom' });
      await t.present();
    } else if (s === 'error') {
      const t = await this.toastCtrl.create({ message: 'Connection failed — last live data is still shown. Check Settings → Test Connection for details.', duration: 4000, color: 'warning', position: 'bottom' });
      await t.present();
    }
  }

  get statusBadgeColor(): string {
    return { demo: 'medium', connecting: 'warning', live: 'success', error: 'danger' }[this.status];
  }

  get statusBadgeLabel(): string {
    return { demo: 'Demo', connecting: 'Connecting…', live: 'Live', error: 'Error' }[this.status];
  }

  get deviceName(): string {
    return this.settings.activeDevice?.name ?? '';
  }

  get chargingStateLabel(): string {
    if (!this.data) return '';
    return CHARGING_STATE_LABELS[this.data.chargingState] ?? 'Unknown';
  }

  get batteryStrokeColor(): string {
    const soc = this.data?.batterySoc ?? 0;
    if (soc > 50) return 'var(--srne-battery-color)';
    if (soc > 20) return 'var(--ion-color-warning)';
    return 'var(--ion-color-danger)';
  }

  get isSolarChargingBattery(): boolean {
    return (this.data?.solarPanelPower ?? 0) > 0 && (this.data?.batteryCurrent ?? 0) > 0;
  }

  get isSolarPoweringLoad(): boolean {
    return (this.data?.solarPanelPower ?? 0) > 0 && (this.data?.loadStatus ?? 0) === 1;
  }

  get isBatteryPoweringLoad(): boolean {
    return (this.data?.batteryCurrent ?? 0) < 0 && (this.data?.loadStatus ?? 0) === 1;
  }

  get isSolarActive(): boolean {
    return (this.data?.solarPanelPower ?? 0) > 0;
  }

  get isBatteryActive(): boolean {
    return Math.abs(this.data?.batteryCurrent ?? 0) > 0.1;
  }

  get isLoadActive(): boolean {
    return (this.data?.loadPower ?? 0) > 0;
  }

  /** Grid power in watts read from registers 0x0213×0x0214 (V×I). 0 when no grid import. */
  get gridPowerW(): number {
    return this.data?.gridPower ?? 0;
  }

  get isGridActive(): boolean {
    return this.gridPowerW > 5;
  }

  get diagramAriaLabel(): string {
    if (!this.data) return 'Power flow diagram — no data';
    return `Solar ${this.fw(this.data.solarPanelPower)}, Battery ${this.data.batterySoc}%, Load ${this.fw(this.data.loadPower)}`;
  }

  /** Format watts as W or kW (e.g. 450 → "450W", 1234 → "1.2kW"). Negative values keep their sign. */
  fw(watts: number): string {
    const abs = Math.abs(watts);
    const sign = watts < 0 ? '-' : '';
    if (abs >= 1000) return sign + (abs / 1000).toFixed(1) + 'kW';
    return sign + abs + 'W';
  }

  /** Battery power in watts: positive = charging, negative = discharging. */
  get batteryPowerW(): number {
    const v = this.data?.batteryVoltage ?? 0;
    const i = this.data?.batteryCurrent ?? 0;
    return Math.round(v * i);
  }

  get batteryPowerLabel(): string {
    const p = this.batteryPowerW;
    if (p > 5) return 'Charging';
    if (p < -5) return 'Discharging';
    return 'Battery W';
  }

  get batteryPowerColor(): string {
    const p = this.batteryPowerW;
    if (p > 5) return 'var(--srne-battery-color)';
    if (p < -5) return 'var(--ion-color-warning)';
    return '#a0a0a0';
  }
}

