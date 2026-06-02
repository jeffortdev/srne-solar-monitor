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
    if (!device.serialNumber) {
      console.warn('[SolarmanV5] Skipped: Logger Serial Number is 0 — configure it in Settings.');
      return null;
    }
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

  /**
   * Runs a step-by-step diagnostic and returns a structured result so the UI
   * can show a meaningful error instead of a generic "no response" message.
   *
   * Stages (in order):
   *  no_serial          — serialNumber is 0 (never configured); dongle will silently drop all packets
   *  plugin_unavailable — capacitor-tcp-connect not available (browser / non-native build)
   *  tcp_failed         — TCP socket timed out or refused (wrong IP, not on dongle WiFi)
   *  no_data            — TCP connected but dongle returned 0 bytes (wrong serial or wrong port)
   *  bad_serial         — Got bytes but SolarmanV5 framing invalid (wrong serial number)
   *  modbus_error       — SolarmanV5 OK but Modbus returned exception (wrong slave ID?)
   *  ok                 — Read succeeded
   */
  async diagnose(device: DeviceConfig): Promise<{ stage: string; message: string }> {
    // Guard: serial number 0 means the user never configured it — the dongle will
    // silently drop every SolarmanV5 packet and we'll always get no_data.
    if (!device.serialNumber) {
      return {
        stage: 'no_serial',
        message:
          'Logger Serial Number is not set (currently 0). ' +
          'Open Settings → Edit Device and enter the 10-digit SN printed on the LSW-5 dongle ' +
          '(also visible in its web UI at http://<IP> → Device Information → Logger SN). ' +
          'Without the correct serial number the dongle will ignore every request.'
      };
    }

    let SocketConnect: any;
    try {
      const mod = await import('capacitor-tcp-connect');
      SocketConnect = (mod as any).SocketConnect;
      if (typeof SocketConnect?.open !== 'function') throw new Error('open not a function');
    } catch {
      return {
        stage: 'plugin_unavailable',
        message:
          'The TCP plugin is not available. The app must be installed as a native ' +
          'Android/iOS build (APK/IPA) — it cannot connect to the dongle in a web browser.'
      };
    }

    // Read 23 registers (0x0100-0x0116) to get a full snapshot for display
    const modbusFrame = this.buildModbusRequest(device.slaveId, 0x0100, 23);
    const v5Packet    = this.buildSolarmanV5Request(device.serialNumber, modbusFrame);
    const text        = String.fromCharCode(...v5Packet);

    let rawResponse: string | undefined;
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Socket timeout')), 6000)
      );
      const result = await Promise.race([
        SocketConnect.open({ ip: device.ip, port: String(device.port), text }),
        timeoutPromise
      ]);
      rawResponse = result?.value as string | undefined;
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      const isTimeout      = /timeout/i.test(msg);
      const isUnreachable  = /unreachable|EHOSTUNREACH|ENETUNREACH/i.test(msg);
      const isRefused      = /refused|ECONNREFUSED/i.test(msg);

      let detail: string;
      if (isUnreachable) {
        detail =
          `Host unreachable — the phone cannot route to ${device.ip}. ` +
          `This almost always means the phone is NOT connected to the LSW-5 WiFi hotspot. ` +
          `Go to Android WiFi settings, connect to the LSW-5 network (SSID usually "LSW-5_XXXXXX"), ` +
          `then try again. The dongle's IP (${device.ip}) is only reachable on its own WiFi.`;
      } else if (isRefused) {
        detail =
          `Connection refused at ${device.ip}:${device.port}. ` +
          `The IP is reachable but nothing is listening on port ${device.port}. ` +
          `Confirm the port is 8899 (not 80 which is the dongle web UI).`;
      } else if (isTimeout) {
        detail =
          `TCP timeout after 6 s connecting to ${device.ip}:${device.port}. ` +
          `Check: (1) phone is on the LSW-5 WiFi hotspot, (2) IP address is correct, (3) port is 8899.`;
      } else {
        detail =
          `TCP error: "${msg}". ` +
          `Make sure the phone is connected to the LSW-5 WiFi hotspot and the IP address is correct.`;
      }
      return { stage: 'tcp_failed', message: detail };
    }

    if (!rawResponse || rawResponse.length === 0) {
      return {
        stage: 'no_data',
        message:
          `TCP connected to ${device.ip}:${device.port} but the dongle returned no data. ` +
          'Most likely cause: the Logger Serial Number is wrong — the dongle silently drops ' +
          `SolarmanV5 packets whose serial does not match (currently using ${device.serialNumber}). ` +
          'Verify it in the LSW-5 web UI (http://<IP> → Device Information → Logger SN). ' +
          'Also confirm the port is 8899 — port 80 is the web UI and will never return Modbus data.'
      };
    }

    const hexResp = Array.from(rawResponse)
      .map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join(' ');
    console.log('[Diagnose] Raw response (hex):', hexResp);

    let modbusRaw: string;
    try {
      modbusRaw = this.extractModbusFromV5Response(rawResponse);
    } catch {
      return {
        stage: 'bad_serial',
        message:
          `TCP connected and ${rawResponse.length} bytes received, but the response does not match ` +
          'SolarmanV5 framing. This almost always means the Logger Serial Number is wrong. ' +
          `Currently using: ${device.serialNumber}. ` +
          'Verify it in the dongle web UI → Device Information (it is the 10-digit SN, not the inverter serial).'
      };
    }

    let values: number[];
    try {
      values = this.parseModbusResponse(modbusRaw, 23);
    } catch (e: any) {
      return {
        stage: 'modbus_error',
        message:
          `SolarmanV5 OK but Modbus returned an error: "${e?.message}". ` +
          `Check the Slave ID (currently ${device.slaveId}) — most SRNE inverters use Slave ID 1.`
      };
    }

    const toSigned16 = (v: number) => v > 0x7FFF ? v - 0x10000 : v;
    const soc      = values[0x0100 - 0x0100];
    const battV    = (values[0x0101 - 0x0100] / 10).toFixed(1);   // scale 0.1
    const battA    = (toSigned16(values[0x0102 - 0x0100]) / 10).toFixed(1);  // scale 0.1, + charging, - discharging
    const battT    = (toSigned16(values[0x0103 - 0x0100]) / 10).toFixed(1);
    const pv1V     = (values[0x0107 - 0x0100] / 10).toFixed(1);
    const pv1A     = (values[0x0108 - 0x0100] / 10).toFixed(1);
    const pv1W     = values[0x0109 - 0x0100];
    const pvTotalW = values[0x010A - 0x0100];   // PV Total Power — what the app uses
    const chgState = values[0x0115 - 0x0100];
    const chgLabel = ['Off', 'Bulk', 'Absorption', 'Float', 'Equalize', 'CV'][chgState] ?? `State ${chgState}`;
    const loadOn   = values[0x0116 - 0x0100] ? 'ON' : 'OFF';

    // Raw dump of all 23 registers so incorrect register mappings can be spotted
    const rawDump = values.map((v, i) =>
      `0x${(0x0100 + i).toString(16).toUpperCase().padStart(4, '0')}=${v}`
    ).join('  ');

    // Probe load block 0x021B-0x021C (Load L1 Active + Apparent Power per SRNE MODBUS Protocol v1.96)
    await new Promise(r => setTimeout(r, 400));
    let loadBlock: number[] | null = null;
    try {
      const loadFrame  = this.buildModbusRequest(device.slaveId, 0x021B, 2);
      const loadPacket = this.buildSolarmanV5Request(device.serialNumber, loadFrame);
      const loadText   = String.fromCharCode(...loadPacket);
      const loadTimeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000));
      const loadResult  = await Promise.race([
        SocketConnect.open({ ip: device.ip, port: String(device.port), text: loadText }),
        loadTimeout
      ]);
      if (loadResult?.value && loadResult.value.length > 0) {
        const loadMbRaw = this.extractModbusFromV5Response(loadResult.value);
        loadBlock = this.parseModbusResponse(loadMbRaw, 2);
      }
    } catch { /* ignore if not supported */ }

    const lines = [
      `Connected to ${device.ip}:${device.port}`,
      `Battery : ${soc}%  |  ${battV} V  |  ${battA} A  |  ${battT} °C`,
      `Solar   : PV1 ${pv1V}V / ${pv1A}A / ${pv1W}W  |  0x010A (PV Total) = ${pvTotalW} W  (app uses 0x010A)`,
      `Charging: ${chgLabel}  |  Load output: ${loadOn}`,
    ];

    if (loadBlock) {
      lines.push(`Load    : 0x021B=${loadBlock[0]} W (active)  |  0x021C=${loadBlock[1]} VA (apparent)`);
    } else {
      lines.push(`Load    : (0x021B block not supported or returned no data)`);
    }

    lines.push(`--- Raw 0x0100 block ---`);
    lines.push(rawDump);

    return { stage: 'ok', message: lines.join('\n') };
  }
}
