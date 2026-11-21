import { sha256 } from '@noble/hashes/sha2.js';
import { toHex } from '../security/crypto';
import { canonicalJson } from '../security/canonical';
import type { AuditEntry, ExportData } from '../types/audit';
import { defaultDb, SonicDB } from './db';

const textEncoder = new TextEncoder();
const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

export class AuditLedger {
  private db: SonicDB;
  private currentDeviceId: string;

  constructor(currentDeviceId = 'unknown_device', db = defaultDb) {
    this.currentDeviceId = currentDeviceId;
    this.db = db;
  }

  setDeviceId(deviceId: string) {
    this.currentDeviceId = deviceId;
  }

  private calculateHash(index: number, timestamp: number, eventType: string, deviceId: string, details: Record<string, unknown>, prevHash: string): string {
    const raw = `${index}|${timestamp}|${eventType}|${deviceId}|${canonicalJson(details)}|${prevHash}`;
    const hashBytes = sha256(textEncoder.encode(raw));
    return toHex(hashBytes);
  }

  async logEvent(eventType: AuditEntry['eventType'], details: Record<string, unknown>): Promise<AuditEntry> {
    const all = await this.db.getAllAudit();
    const index = all.length;
    const prevHash = index === 0 ? GENESIS_PREV_HASH : all[index - 1].hash;
    const timestamp = Date.now();
    const hash = this.calculateHash(index, timestamp, eventType, this.currentDeviceId, details, prevHash);

    const entry: AuditEntry = {
      index,
      timestamp,
      eventType,
      deviceId: this.currentDeviceId,
      details,
      prevHash,
      hash,
    };

    await this.db.addAudit(entry);
    return entry;
  }

  async getEntries(): Promise<AuditEntry[]> {
    return await this.db.getAllAudit();
  }

  /**
   * Verifies the cryptographic hash-linked integrity of the entire audit chain.
   * Detects any tampering or omitted history.
   */
  async verifyIntegrity(): Promise<{ valid: boolean; brokenAtIndex?: number; reason?: string }> {
    const entries = await this.db.getAllAudit();
    if (entries.length === 0) return { valid: true };

    let expectedPrevHash = GENESIS_PREV_HASH;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.index !== i) {
        return { valid: false, brokenAtIndex: i, reason: `Index sequence mismatch at ${i}: found ${entry.index}` };
      }
      if (entry.prevHash !== expectedPrevHash) {
        return { valid: false, brokenAtIndex: i, reason: `Previous hash pointer broken at index ${i}` };
      }
      const recomputedHash = this.calculateHash(
        entry.index,
        entry.timestamp,
        entry.eventType,
        entry.deviceId,
        entry.details,
        entry.prevHash
      );
      if (recomputedHash !== entry.hash) {
        return { valid: false, brokenAtIndex: i, reason: `Tampered hash at index ${i}` };
      }
      expectedPrevHash = entry.hash;
    }
    return { valid: true };
  }

  async exportJson(): Promise<string> {
    const entries = await this.db.getAllAudit();
    const exportData: ExportData = {
      exportedAt: Date.now(),
      deviceId: this.currentDeviceId,
      totalEntries: entries.length,
      entries,
    };
    return JSON.stringify(exportData, null, 2);
  }

  async exportCsv(): Promise<string> {
    const entries = await this.db.getAllAudit();
    const headers = ['Index', 'Timestamp', 'ISO_Time', 'Event_Type', 'Device_ID', 'Details_JSON', 'Prev_Hash', 'Hash'];
    const rows = entries.map(e => [
      e.index,
      e.timestamp,
      `"${new Date(e.timestamp).toISOString()}"`,
      `"${e.eventType}"`,
      `"${e.deviceId}"`,
      `"${JSON.stringify(e.details).replace(/"/g, '""')}"`,
      `"${e.prevHash}"`,
      `"${e.hash}"`,
    ]);
    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

export const defaultAuditLedger = new AuditLedger();
