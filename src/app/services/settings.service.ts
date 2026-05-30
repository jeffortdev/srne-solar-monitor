import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { AppSettings, DeviceConfig } from '../models/srne.models';

const DEVICES_KEY = 'srne_devices';
const SETTINGS_KEY = 'srne_settings';

const DEFAULT_SETTINGS: AppSettings = {
  activeDeviceId: null,
  showGrid: false,
  darkMode: true,
  pollIntervalSec: 5
};

@Injectable({ providedIn: 'root' })
export class SettingsService {

  private _devices: DeviceConfig[] = [];
  private _settings: AppSettings = { ...DEFAULT_SETTINGS };

  async load(): Promise<void> {
    const [devResult, setResult] = await Promise.all([
      Preferences.get({ key: DEVICES_KEY }),
      Preferences.get({ key: SETTINGS_KEY })
    ]);
    this._devices = devResult.value ? JSON.parse(devResult.value) : [];
    this._settings = setResult.value
      ? { ...DEFAULT_SETTINGS, ...JSON.parse(setResult.value) }
      : { ...DEFAULT_SETTINGS };
  }

  get devices(): DeviceConfig[] { return this._devices; }
  get settings(): AppSettings { return this._settings; }

  get activeDevice(): DeviceConfig | null {
    return this._devices.find(d => d.id === this._settings.activeDeviceId) ?? null;
  }

  async saveDevice(device: DeviceConfig): Promise<void> {
    const idx = this._devices.findIndex(d => d.id === device.id);
    if (idx >= 0) {
      this._devices[idx] = device;
    } else {
      this._devices.push(device);
    }
    await Preferences.set({ key: DEVICES_KEY, value: JSON.stringify(this._devices) });
  }

  async deleteDevice(id: string): Promise<void> {
    this._devices = this._devices.filter(d => d.id !== id);
    if (this._settings.activeDeviceId === id) {
      this._settings.activeDeviceId = this._devices[0]?.id ?? null;
    }
    await Promise.all([
      Preferences.set({ key: DEVICES_KEY, value: JSON.stringify(this._devices) }),
      this.saveSettings()
    ]);
  }

  async setActiveDevice(id: string): Promise<void> {
    this._settings.activeDeviceId = id;
    await this.saveSettings();
  }

  async updateSettings(partial: Partial<AppSettings>): Promise<void> {
    this._settings = { ...this._settings, ...partial };
    await this.saveSettings();
  }

  private async saveSettings(): Promise<void> {
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(this._settings) });
  }
}
