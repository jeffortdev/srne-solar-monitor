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
  username: string;
  password: string;
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
  form: DeviceForm = { name: '', ip: '', port: 8899, slaveId: 1, serialNumber: 0, username: 'admin', password: 'admin' };

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
    this.form = { name: '', ip: '', port: 8899, slaveId: 1, serialNumber: 0, username: 'admin', password: 'admin' };
    this.showAddModal = true;
  }

  openEditDevice(device: DeviceConfig): void {
    this.editingDevice = device;
    this.form = {
      name: device.name,
      ip: device.ip,
      port: device.port,
      slaveId: device.slaveId,
      serialNumber: device.serialNumber,
      username: device.username || 'admin',
      password: device.password || 'admin'
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
      serialNumber: Number(this.form.serialNumber) || 0,
      username: this.form.username?.trim() || 'admin',
      password: this.form.password || 'admin'
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
          // Populate the form so the user can review before saving
          this.form.ip   = parsed.ip;
          this.form.port = parsed.port || 8899;
          if (parsed.serialNumber) this.form.serialNumber = parsed.serialNumber;
          if (parsed.password)     this.form.password     = parsed.password;
          if (parsed.name)         this.form.name         = parsed.name;
          if (!this.form.name)     this.form.name         = `HESP4860S100-H (${parsed.ip})`;

          const filled: string[] = ['IP'];
          if (parsed.serialNumber) filled.push('Serial Number');
          if (parsed.password)     filled.push('Password');
          await this.showToast(`QR scanned — filled: ${filled.join(', ')}. Review and tap Save.`, 'success');
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

  private async autoSaveDevice(parsed: { ip: string; port: number; serialNumber?: number; password?: string; name?: string }): Promise<void> {
    const deviceName = parsed.name || `HESP4860S100-H (${parsed.ip})`;
    
    const id = crypto.randomUUID();
    const device: DeviceConfig = {
      id,
      name: deviceName.trim(),
      ip: parsed.ip.trim(),
      port: parsed.port || 8899,
      slaveId: 1,
      serialNumber: parsed.serialNumber || 0,
      username: 'admin',
      password: parsed.password || 'admin'
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
    
    const notice = device.serialNumber
      ? `Device "${deviceName}" added!`
      : `Device "${deviceName}" added — please enter the serial number manually.`;
    await this.showToast(notice, 'success');
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
   * Parses QR payload from the LSW-5 dongle.
   *
   * Known formats:
   *  1. JSON (most complete):
   *       {"ap":"LSW-5_XXXXXX","ip":"10.10.100.254","port":8899,"sn":1720747149,"pwd":"12345678"}
   *  2. Key-value pairs (common on sticker labels):
   *       SN:1720747149,PWD:12345678,IP:10.10.100.254,PORT:8899
   *       or with semicolons: SN:1720747149;PWD:12345678;IP:10.10.100.254
   *  3. Colon-delimited: "10.10.100.254:8899:1720747149"
   *  4. IP only: "10.10.100.254"
   *
   * Returns null if no IP can be found.
   */
  private parseQrValue(
    raw: string
  ): { ip: string; port: number; serialNumber?: number; password?: string; name?: string } | null {
    const trimmed = raw.trim();

    // ── Format 1: JSON ──────────────────────────────────────────────────────
    if (trimmed.startsWith('{')) {
      try {
        const j = JSON.parse(trimmed);
        if (j.ip) {
          return {
            ip:           j.ip,
            port:         j.port         || 8899,
            serialNumber: j.sn ?? j.serialNumber ?? j.serial ?? undefined,
            password:     j.pwd ?? j.password ?? j.pass ?? undefined,
            name:         j.ap  ?? j.ssid ?? j.name ?? undefined
          };
        }
      } catch { /* not JSON */ }
    }

    // ── Format 2: key=value pairs (comma or semicolon separated) ───────────
    // e.g.  SN:1720747149,PWD:12345678,IP:10.10.100.254,PORT:8899
    if (/SN:|IP:|PWD:/i.test(trimmed)) {
      const kv: Record<string, string> = {};
      trimmed.split(/[,;]/).forEach(pair => {
        const [k, v] = pair.trim().split(':');
        if (k && v !== undefined) kv[k.trim().toUpperCase()] = v.trim();
      });

      const ip = kv['IP'];
      if (ip) {
        return {
          ip,
          port:         kv['PORT'] ? parseInt(kv['PORT'], 10) : 8899,
          serialNumber: kv['SN']   ? parseInt(kv['SN'],   10) : undefined,
          password:     kv['PWD']  || undefined
        };
      }
    }

    // ── Format 3: ip:port:serial ────────────────────────────────────────────
    const ipPortMatch = trimmed.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):?(\d{4,5})?:?(\d{6,12})?/);
    if (ipPortMatch) {
      return {
        ip:           ipPortMatch[1],
        port:         ipPortMatch[2] ? parseInt(ipPortMatch[2], 10) : 8899,
        serialNumber: ipPortMatch[3] ? parseInt(ipPortMatch[3], 10) : undefined
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

