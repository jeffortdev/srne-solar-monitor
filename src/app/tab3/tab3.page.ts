import { Component, OnInit } from '@angular/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { DeviceConfig } from '../models/srne.models';
import { SettingsService } from '../services/settings.service';
import { SrneDataService } from '../services/srne-data.service';
import { ModbusTcpService } from '../services/modbus-tcp.service';

interface DeviceForm {
  name: string;
  ip: string;
  port: number;
  slaveId: number;
}

@Component({
  selector: 'app-tab3',
  templateUrl: 'tab3.page.html',
  styleUrls: ['tab3.page.scss'],
  standalone: false,
})
export class Tab3Page implements OnInit {

  devices: DeviceConfig[] = [];
  activeDeviceId: string | null = null;
  showGrid = false;
  pollInterval: number = 5;

  showAddModal = false;
  editingDevice: DeviceConfig | null = null;
  form: DeviceForm = { name: '', ip: '', port: 8899, slaveId: 1 };

  testingConnection = false;
  testResult: { ok: boolean; message: string } | null = null;

  constructor(
    private settings: SettingsService,
    private srne: SrneDataService,
    private modbus: ModbusTcpService
  ) {}

  ngOnInit(): void {
    this.loadSettings();
  }

  ionViewWillEnter(): void {
    this.loadSettings();
  }

  private loadSettings(): void {
    this.devices = [...this.settings.devices];
    this.activeDeviceId = this.settings.settings.activeDeviceId;
    this.showGrid = this.settings.settings.showGrid;
    this.pollInterval = this.settings.settings.pollIntervalSec;
  }

  // ── Device management ─────────────────────────────────────

  async setActive(id: string): Promise<void> {
    await this.settings.setActiveDevice(id);
    this.activeDeviceId = id;
    this.srne.restartPolling();
    this.testResult = null;
  }

  async deleteDevice(id: string): Promise<void> {
    await this.settings.deleteDevice(id);
    this.devices = [...this.settings.devices];
    this.activeDeviceId = this.settings.settings.activeDeviceId;
  }

  openAddDevice(): void {
    this.editingDevice = null;
    this.form = { name: '', ip: '', port: 8899, slaveId: 1 };
    this.showAddModal = true;
  }

  closeAddDevice(): void {
    this.showAddModal = false;
  }

  async saveDevice(): Promise<void> {
    const id = this.editingDevice?.id ?? crypto.randomUUID();
    const device: DeviceConfig = {
      id,
      name: this.form.name.trim(),
      ip: this.form.ip.trim(),
      port: Number(this.form.port) || 8899,
      slaveId: Number(this.form.slaveId) || 1
    };
    await this.settings.saveDevice(device);
    if (!this.settings.settings.activeDeviceId) {
      await this.settings.setActiveDevice(id);
    }
    this.loadSettings();
    this.srne.restartPolling();
    this.closeAddDevice();
  }

  // ── QR Code scan ─────────────────────────────────────────

  async scanQr(): Promise<void> {
    try {
      const granted = await BarcodeScanner.requestPermissions();
      if (granted.camera !== 'granted' && granted.camera !== 'limited') return;

      const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode]
      });

      if (result.barcodes?.length) {
        const raw = result.barcodes[0].rawValue ?? '';
        this.parseQrValue(raw);
      }
    } catch (e: any) {
      console.warn('QR scan error:', e);
    }
  }

  /**
   * Parses QR payload from SRNE WiFi dongle.
   * Common formats:
   *  - "192.168.4.1:8899"
   *  - JSON: {"ip":"192.168.4.1","port":8899}
   *  - WiFi credentials string with IP embedded
   */
  private parseQrValue(raw: string): void {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.ip) this.form.ip = parsed.ip;
      if (parsed.port) this.form.port = parsed.port;
      if (parsed.name) this.form.name = parsed.name;
      return;
    } catch { /* not JSON */ }

    const ipPortMatch = raw.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):?(\d{4,5})?/);
    if (ipPortMatch) {
      this.form.ip = ipPortMatch[1];
      if (ipPortMatch[2]) this.form.port = parseInt(ipPortMatch[2], 10);
    }
  }

  // ── Connection test ───────────────────────────────────────

  async testConnection(): Promise<void> {
    const device = this.settings.activeDevice;
    if (!device) return;

    this.testingConnection = true;
    this.testResult = null;
    const start = Date.now();

    const result = await this.modbus.readHoldingRegisters(device, 0x0100, 1);
    const elapsed = Date.now() - start;

    this.testingConnection = false;
    if (result !== null) {
      this.testResult = { ok: true, message: `Connected in ${elapsed}ms` };
    } else {
      this.testResult = { ok: false, message: 'Could not reach device — check IP and WiFi' };
    }
  }

  // ── Display prefs ─────────────────────────────────────────

  async saveDisplayPrefs(): Promise<void> {
    await this.settings.updateSettings({
      showGrid: this.showGrid,
      pollIntervalSec: Number(this.pollInterval)
    });
    this.srne.restartPolling();
  }
}

