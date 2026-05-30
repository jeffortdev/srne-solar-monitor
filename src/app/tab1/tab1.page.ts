import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { SrneData, CHARGING_STATE_LABELS } from '../models/srne.models';
import { SrneDataService } from '../services/srne-data.service';
import { SettingsService } from '../services/settings.service';

@Component({
  selector: 'app-tab1',
  templateUrl: 'tab1.page.html',
  styleUrls: ['tab1.page.scss'],
  standalone: false,
})
export class Tab1Page implements OnInit, OnDestroy {

  data: SrneData | null = null;
  connected = false;
  showGrid = false;

  private subs: Subscription[] = [];

  constructor(
    private srne: SrneDataService,
    private settings: SettingsService
  ) {}

  ngOnInit(): void {
    this.showGrid = this.settings.settings.showGrid;
    this.subs.push(
      this.srne.data$.subscribe(d => this.data = d),
      this.srne.connected$.subscribe(c => this.connected = c)
    );
  }

  ionViewWillEnter(): void {
    this.showGrid = this.settings.settings.showGrid;
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
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

