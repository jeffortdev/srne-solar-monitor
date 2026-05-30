import { Injectable } from '@angular/core';
import { DeviceConfig } from '../models/srne.models';

/**
 * ModbusTcpService — wraps Modbus RTU frames inside the SolarmanV5 protocol and sends
 * them over TCP to the LSW-5 WiFi data logger dongle connected to the HESP4860S100-H.
 * Protocol: SolarmanV5 on port 8899 (requires the dongle's logger serial number).
 * Uses capacitor-tcp-connect (SocketConnect.open) on native Android/iOS.
 * Falls back to null on web browser or on any connection error.
 */
@Injectable({ providedIn: 'root' })
export class ModbusTcpService {

  private sequenceNo = 0;

  // ── CRC16 (Modbus) ────────────────────────────────────────────────────────

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

  // ── Modbus RTU request builder ─────────────────────────────────────────────

  private buildModbusRequest(slaveId: number, startReg: number, count: number): Uint8Array {
    const frame = new Uint8Array(6);
    frame[0] = slaveId;
    frame[1] = 0x03; // Read Holding Registers
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

  // ── SolarmanV5 packet builder ──────────────────────────────────────────────
  //
  // Packet structure:
  //   [0]      0xA5               — start-of-frame
  //   [1-2]    payloadLen (LE)    — length of inner payload
  //   [3-4]    0x10 0x45          — control code (data request)
  //   [5-6]    sequenceNo (LE)
  //   [7-10]   serialNo (LE)      — logger serial number from dongle web UI
  //   [11..11+15-1]               — inner header (15 bytes): frame type, sensor type, timestamps
  //   [11+15..] modbusRtuFrame    — 8-byte Modbus RTU request
  //   [last-1] checksum           — sum of bytes [1..last-2] mod 256
  //   [last]   0x15               — end-of-frame

  private buildSolarmanV5Request(serialNo: number, modbusFrame: Uint8Array): Uint8Array {
    const seq = this.sequenceNo++ & 0xFFFF;
    const INNER_HDR_LEN = 15;
    const payloadLen = INNER_HDR_LEN + modbusFrame.length;
    const totalLen = 11 + payloadLen + 2; // outer(11) + payload + cs(1) + end(1)
    const pkt = new Uint8Array(totalLen);

    let i = 0;
    pkt[i++] = 0xA5;
    pkt[i++] = payloadLen & 0xFF;
    pkt[i++] = (payloadLen >> 8) & 0xFF;
    pkt[i++] = 0x10; // control
    pkt[i++] = 0x45;
    pkt[i++] = seq & 0xFF;
    pkt[i++] = (seq >> 8) & 0xFF;
    pkt[i++] =  serialNo & 0xFF;
    pkt[i++] = (serialNo >> 8)  & 0xFF;
    pkt[i++] = (serialNo >> 16) & 0xFF;
    pkt[i++] = (serialNo >>> 24) & 0xFF; // unsigned right-shift for bit 31

    // Inner header (15 bytes): frame_type, sensor_type(2), delivery_time(4), power_on_time(4), offset_time(4)
    pkt[i++] = 0x02; // frame type: request real-time data
    pkt[i++] = 0x00; pkt[i++] = 0x00; // sensor type
    pkt[i++] = 0x00; pkt[i++] = 0x00; pkt[i++] = 0x00; pkt[i++] = 0x00; // delivery time
    pkt[i++] = 0x00; pkt[i++] = 0x00; pkt[i++] = 0x00; pkt[i++] = 0x00; // power on time
    pkt[i++] = 0x00; pkt[i++] = 0x00; pkt[i++] = 0x00; pkt[i++] = 0x00; // offset time

    // Modbus RTU frame
    pkt.set(modbusFrame, i);
    i += modbusFrame.length;

    // Checksum: sum of bytes [1..i-1] mod 256
    let cs = 0;
    for (let j = 1; j < i; j++) cs = (cs + pkt[j]) & 0xFF;
    pkt[i++] = cs;
    pkt[i++] = 0x15; // end-of-frame

    return pkt;
  }

  // ── SolarmanV5 response parser ─────────────────────────────────────────────
  //
  // Response structure:
  //   [0]      0xA5
  //   [1-2]    payload length (LE)
  //   [3-4]    0x10 0x15           — response control code
  //   [5-6]    sequenceNo (LE)
  //   [7-10]   serialNo (LE)
  //   [11..]   inner response header (14 or 15 bytes depending on firmware)
  //            followed by the Modbus RTU response
  //   [last-1] checksum
  //   [last]   0x15
  //
  // We probe offsets 25 (11+14) and 26 (11+15) and validate by checking the
  // Modbus function code byte at position +1 within the candidate frame.

  private extractModbusFromV5Response(raw: string): string {
    const bytes = Array.from(raw).map(c => c.charCodeAt(0));

    if (bytes.length < 28 || bytes[0] !== 0xA5 || bytes[bytes.length - 1] !== 0x15) {
      throw new Error('Invalid SolarmanV5 response frame (bad start/end markers)');
    }

    for (const offset of [25, 26]) {
      if (bytes.length > offset + 4) {
        const fc = bytes[offset + 1];
        // Valid Modbus function codes for read-holding-regs: 0x03 or error 0x83
        if (fc === 0x03 || (fc & 0x80)) {
          return bytes.slice(offset, bytes.length - 2).map(b => String.fromCharCode(b)).join('');
        }
      }
    }

    throw new Error('Could not locate Modbus RTU response inside SolarmanV5 packet');
  }

  // ── Modbus RTU response parser ─────────────────────────────────────────────

  private parseModbusResponse(raw: string, expectedCount: number): number[] {
    if (raw.length < 5) throw new Error('Modbus response too short');
    const bytes = Array.from(raw).map(c => c.charCodeAt(0));
    if (bytes[1] & 0x80) throw new Error(`Modbus exception code: 0x${bytes[2].toString(16).toUpperCase()}`);
    const byteCount = bytes[2];
    const values: number[] = [];
    for (let i = 0; i < byteCount; i += 2) {
      values.push((bytes[3 + i] << 8) | bytes[4 + i]);
    }
    return values.slice(0, expectedCount);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async readHoldingRegisters(
    device: DeviceConfig,
    startReg: number,
    count: number
  ): Promise<number[] | null> {
    try {
      const { SocketConnect } = await import('capacitor-tcp-connect');

      const modbusFrame = this.buildModbusRequest(device.slaveId, startReg, count);
      const v5Packet    = this.buildSolarmanV5Request(device.serialNumber, modbusFrame);
      const text        = String.fromCharCode(...v5Packet);

      const hexReq = Array.from(v5Packet).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
      console.log(`[SolarmanV5] → ${device.ip}:${device.port}  Serial: ${device.serialNumber}  SlaveID: ${device.slaveId}`);
      console.log(`[SolarmanV5] Reg 0x${startReg.toString(16).toUpperCase().padStart(4, '0')} × ${count}  frame: ${hexReq}`);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Socket timeout (5s)')), 5000)
      );

      const result = await Promise.race([
        (SocketConnect as any).open({ ip: device.ip, port: String(device.port), text }),
        timeoutPromise
      ]);

      if (result?.value) {
        const hexResp = Array.from(result.value as string).map((c: string) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ');
        console.log('[SolarmanV5] Response (hex):', hexResp);
      }

      const modbusResp = this.extractModbusFromV5Response(result.value);
      return this.parseModbusResponse(modbusResp, count);
    } catch (e: any) {
      console.error('[SolarmanV5] Error:', { message: e?.message, code: e?.code, error: e });
      return null;
    }
  }
}
