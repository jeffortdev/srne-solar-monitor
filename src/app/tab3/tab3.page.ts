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
        if (parsed) {
          console.log('QR parsed successfully:', parsed);
          // Auto-save device after successful QR parse
          await this.autoSaveDevice(parsed);
        } else {
          await this.showToast('Could not parse QR code. Try manual entry.', 'warning');
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

  private async autoSaveDevice(parsed: { ip: string; port: number; name?: string }): Promise<void> {
    // Auto-generate device name if not provided
    const deviceName = parsed.name || `SRNE ${parsed.ip}`;
    
    const id = crypto.randomUUID();
    const device: DeviceConfig = {
      id,
      name: deviceName.trim(),
      ip: parsed.ip.trim(),
      port: parsed.port || 8899,
      slaveId: 1
    };

    console.log('Auto-saving device:', device);
    await this.settings.saveDevice(device);
    
    // Set as active device if none is active
    if (!this.settings.settings.activeDeviceId) {
      await this.settings.setActiveDevice(id);
    }

    this.loadSettings();
    this.srne.restartPolling();
    this.closeAddDevice();
    
    await this.showToast(`Device "${deviceName}" added successfully!`, 'success');
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
   * Parses QR payload from SRNE WiFi dongle.
   * Common formats:
   *  - "192.168.4.1:8899"
   *  - JSON: {"ip":"192.168.4.1","port":8899}
   *  - WiFi credentials string with IP embedded
   * 
   * Returns parsed config or null if invalid
   */
  private parseQrValue(raw: string): { ip: string; port: number; name?: string } | null {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.ip) {
        return {
          ip: parsed.ip,
          port: parsed.port || 8899,
          name: parsed.name
        };
      }
    } catch { /* not JSON */ }

    const ipPortMatch = raw.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):?(\d{4,5})?/);
    if (ipPortMatch) {
      return {
        ip: ipPortMatch[1],
        port: ipPortMatch[2] ? parseInt(ipPortMatch[2], 10) : 8899
      };
    }

    return null;
  }

  // ── Connection test ───────────────────────────────────────

  async testConnection(): Promise<void> {
    const device = this.settings.activeDevice;
    if (!device) return;

    this.testingConnection = true;
    this.testResult = null;
    const start = Date.now();

    console.log(`[Test] Starting connection test to ${device.ip}:${device.port}`);

    // Try multiple registers to find one that works
    // 0x0100 = Battery SOC, 0x0101 = Battery Voltage, 0x010F = PV Power, 0x3200 = Daily Generation
    const registersToTry = [0x0100, 0x0101, 0x010F, 0x3200, 0x0000, 0x0001];
    let result = null;
    let testedRegs = '';

    for (const reg of registersToTry) {
      console.log(`[Test] Trying register 0x${reg.toString(16).toUpperCase().padStart(4, '0')}`);
      result = await this.modbus.readHoldingRegisters(device, reg, 1);
      testedRegs += `0x${reg.toString(16).toUpperCase().padStart(4, '0')} `;
      if (result !== null) {
        console.log(`[Test] ✓ Register 0x${reg.toString(16).toUpperCase().padStart(4, '0')} responded with:`, result);
        break;
      }
    }

    const elapsed = Date.now() - start;
    this.testingConnection = false;

    if (result !== null) {
      this.testResult = { ok: true, message: `Connected in ${elapsed}ms (value: ${result[0]})` };
    } else {
      this.testResult = { 
        ok: false, 
        message: `No response from device. Check console logs. Tried: ${testedRegs.trim()}`
      };
      console.error('[Test] All registers failed. Check device IP, port, and Modbus compatibility.');
      console.error('[Test] Check console logs above for [Modbus] error details.');
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

