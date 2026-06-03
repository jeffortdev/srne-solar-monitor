import { Component, OnInit } from '@angular/core';
import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { ToastController } from '@ionic/angular';
import { DeviceConfig } from '../models/srne.models';
import { SettingsService } from '../services/settings.service';
import { SrneDataService } from '../services/srne-data.service';
import { ModbusTcpService } from '../services/modbus-tcp.service';

interface DeviceForm {
  name: string;
  ip: string;
  port: number;
  slaveId: number;
  serialNumber: number;
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
  form: DeviceForm = { name: '', ip: '', port: 8899, slaveId: 1, serialNumber: 0 };

  testingConnection = false;
  testResult: { ok: boolean; message: string } | null = null;

  constructor(
    private settings: SettingsService,
    private srne: SrneDataService,
    private modbus: ModbusTcpService,
    private toastController: ToastController
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
    this.form = { name: '', ip: '', port: 8899, slaveId: 1, serialNumber: 0 };
    this.showAddModal = true;
  }

  openEditDevice(device: DeviceConfig): void {
    this.editingDevice = device;
    this.form = {
      name: device.name,
      ip: device.ip,
      port: device.port,
      slaveId: device.slaveId,
      serialNumber: device.serialNumber
    };
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
      slaveId: Number(this.form.slaveId) || 1,
      serialNumber: Number(this.form.serialNumber) || 0
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
      console.log('QR scan: Requesting camera permissions...');
      const granted = await BarcodeScanner.requestPermissions();
      console.log('Camera permissions:', granted);

      if (granted.camera !== 'granted' && granted.camera !== 'limited') {
        await this.showToast('Camera permission denied. Please enable it in Settings.', 'warning');
        console.warn('Camera permission denied:', granted.camera);
        return;
      }

      console.log('QR scan: Starting barcode scan...');
      const result = await BarcodeScanner.scan({
        formats: [BarcodeFormat.QrCode]
      });

      console.log('QR scan result:', result);

      if (result.barcodes?.length) {
        const raw = result.barcodes[0].rawValue ?? '';
        console.log('QR value scanned:', raw);
        
        const parsed = this.parseQrValue(raw);
        if (parsed?.serialNumber) {
          console.log('QR parsed successfully:', parsed);
          this.form.serialNumber = parsed.serialNumber;
          await this.showToast(`QR scanned — Serial Number filled. Review and tap Save.`, 'success');
        } else {
          await this.showToast('Serial number not found in QR code. Try manual entry.', 'warning');
        }
      } else {
        await this.showToast('No QR code detected. Try again.', 'warning');
        console.warn('No barcodes found in scan result');
      }
    } catch (e: any) {
      console.error('QR scan error:', e);
      await this.showToast(
        `Scan failed: ${e?.message || 'Unknown error'}`,
        'danger'
      );
    }
  }

  private async autoSaveDevice(parsed: { ip: string; port: number; serialNumber?: number; name?: string }): Promise<void> {
    const deviceName = parsed.name || `HESP4860S100-H (${parsed.ip})`;
    const id = crypto.randomUUID();
    const device: DeviceConfig = {
      id,
      name: deviceName.trim(),
      ip: parsed.ip.trim(),
      port: parsed.port || 8899,
      slaveId: 1,
      serialNumber: parsed.serialNumber || 0
    };

    await this.settings.saveDevice(device);
    if (!this.settings.settings.activeDeviceId) {
      await this.settings.setActiveDevice(id);
    }
    this.loadSettings();
    this.srne.restartPolling();
    this.closeAddDevice();
    const notice = device.serialNumber
      ? `Device "${deviceName}" added!`
      : `Device "${deviceName}" added — please enter the serial number manually.`;
    await this.showToast(notice, 'success');
  }

  /**
   * Standalone QR scan on the Settings page — scans the LSW-5 QR code and
   * directly updates the serial number (and IP/port if changed) of the active device.
   */
  async scanAndUpdateSerial(): Promise<void> {
    const device = this.settings.activeDevice;
    if (!device) {
      await this.showToast('No active device. Add a device first.', 'warning');
      return;
    }
    try {
      const granted = await BarcodeScanner.requestPermissions();
      if (granted.camera !== 'granted' && granted.camera !== 'limited') {
        await this.showToast('Camera permission denied. Please enable it in Settings.', 'warning');
        return;
      }
      const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
      if (!result.barcodes?.length) {
        await this.showToast('No QR code detected. Try again.', 'warning');
        return;
      }
      const raw = result.barcodes[0].rawValue ?? '';
      const parsed = this.parseQrValue(raw);
      if (!parsed?.serialNumber) {
        await this.showToast('Serial number not found in QR code. Try manual entry.', 'warning');
        return;
      }
      const updated: DeviceConfig = {
        ...device,
        serialNumber: parsed.serialNumber
      };
      await this.settings.saveDevice(updated);
      this.loadSettings();
      this.srne.restartPolling();
      await this.showToast(`Serial number updated to ${parsed.serialNumber}.`, 'success');
    } catch (e: any) {
      await this.showToast(`Scan failed: ${e?.message || 'Unknown error'}`, 'danger');
    }
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'warning'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color
    });
    await toast.present();
  }

  /**
   * Parses QR payload from the LSW-5 dongle sticker.
   *
   * The LSW-5 QR code contains only the serial number and password — no IP.
   * Known formats:
   *  1. Key-value pairs:  SN:1720747149,PWD:12345678
   *                       or semicolons: SN:1720747149;PWD:12345678
   *  2. JSON:             {"sn":1720747149,"pwd":"12345678"}
   *  3. Bare number:      1720747149
   *
   * Returns null if no serial number can be found.
   */
  private parseQrValue(raw: string): { serialNumber: number } | null {
    const trimmed = raw.trim();

    // ── Format 1: JSON ──────────────────────────────────────────────────────
    if (trimmed.startsWith('{')) {
      try {
        const j = JSON.parse(trimmed);
        const sn = j.sn ?? j.serialNumber ?? j.serial ?? j.SN;
        if (sn) return { serialNumber: Number(sn) };
      } catch { /* not JSON */ }
    }

    // ── Format 2: key=value pairs (comma or semicolon separated) ───────────
    if (/SN:/i.test(trimmed)) {
      const kv: Record<string, string> = {};
      trimmed.split(/[,;]/).forEach(pair => {
        const firstColon = pair.indexOf(':');
        if (firstColon < 0) return;
        const k = pair.substring(0, firstColon).trim().toUpperCase();
        const v = pair.substring(firstColon + 1).trim();
        if (k) kv[k] = v;
      });
      if (kv['SN']) return { serialNumber: parseInt(kv['SN'], 10) };
    }

    // ── Format 3: bare number (6–12 digits) ─────────────────────────────────
    if (/^\d{6,12}$/.test(trimmed)) {
      return { serialNumber: parseInt(trimmed, 10) };
    }

    return null;
  }

  // ── Connection test ───────────────────────────────────────

  async testConnection(): Promise<void> {
    const device = this.settings.activeDevice;
    if (!device) return;

    this.testingConnection = true;
    this.testResult = null;

    const { stage, message } = await this.modbus.diagnose(device);

    this.testingConnection = false;
    this.testResult = { ok: stage === 'ok', message };
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

