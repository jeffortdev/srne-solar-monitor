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
      const t = await this.toastCtrl.create({ message: 'Connection failed — showing demo data. Check Settings → Test Connection for details.', duration: 4000, color: 'warning', position: 'bottom' });
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

  get diagramAriaLabel(): string {
    if (!this.data) return 'Power flow diagram — no data';
    return `Solar ${this.data.solarPanelPower}W, Battery ${this.data.batterySoc}%, Load ${this.data.loadPower}W`;
  }
}

