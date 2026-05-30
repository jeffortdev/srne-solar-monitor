import { Injectable } from '@angular/core';
import { DeviceConfig } from '../models/srne.models';

/**
 * ModbusTcpService — sends Modbus RTU frames over TCP to the SRNE WiFi dongle.
 * Uses capacitor-tcp-connect (SocketConnect.open) on native Android/iOS.
 * Falls back to null on web browser or on any connection error.
 */
@Injectable({ providedIn: 'root' })
export class ModbusTcpService {

  private crc16(data: Uint8Array): number {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc & 0x0001) ? (crc >> 1) ^ 0xA001 : crc >> 1;
      }
    }
    return crc;
  }

  private buildRequest(slaveId: number, startReg: number, count: number): Uint8Array {
    const frame = new Uint8Array(6);
    frame[0] = slaveId;
    frame[1] = 0x03;
    frame[2] = (startReg >> 8) & 0xFF;
    frame[3] = startReg & 0xFF;
    frame[4] = (count >> 8) & 0xFF;
    frame[5] = count & 0xFF;
    const crc = this.crc16(frame);
    const pdu = new Uint8Array(8);
    pdu.set(frame);
    pdu[6] = crc & 0xFF;
    pdu[7] = (crc >> 8) & 0xFF;
    return pdu;
  }

  private parseResponse(raw: string, expectedCount: number): number[] {
    if (raw.length < 5) throw new Error('Modbus response too short');
    const bytes = Array.from(raw).map(c => c.charCodeAt(0));
    if (bytes[1] & 0x80) throw new Error(`Modbus exception: ${bytes[2]}`);
    const byteCount = bytes[2];
    const values: number[] = [];
    for (let i = 0; i < byteCount; i += 2) {
      values.push((bytes[3 + i] << 8) | bytes[4 + i]);
    }
    return values.slice(0, expectedCount);
  }

  async readHoldingRegisters(
    device: DeviceConfig,
    startReg: number,
    count: number
  ): Promise<number[] | null> {
    try {
      const { SocketConnect } = await import('capacitor-tcp-connect');
      const request = this.buildRequest(device.slaveId, startReg, count);
      const text = String.fromCharCode(...request);
      const result = await (SocketConnect as any).open({
        ip: device.ip,
        port: String(device.port),
        text
      });
      return this.parseResponse(result.value, count);
    } catch {
      return null;
    }
  }
}
