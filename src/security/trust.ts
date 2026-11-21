import type { TrustedDevice, TrustLevel } from '../types/identity';
import { deriveFingerprint } from './crypto';
import { getStorage } from './storage-helper';

const STORAGE_KEY_TRUST = 'sonicbridge_trusted_devices';

export class TrustRegistry {
  private devices = new Map<string, TrustedDevice>();

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY_TRUST);
      if (raw) {
        const list = JSON.parse(raw) as TrustedDevice[];
        this.devices.clear();
        for (const dev of list) {
          this.devices.set(dev.id, dev);
        }
      }
    } catch (e) {
      console.warn('Could not load trusted devices registry:', e);
    }
  }

  private save() {
    try {
      const list = Array.from(this.devices.values());
      getStorage().setItem(STORAGE_KEY_TRUST, JSON.stringify(list));
    } catch (e) {
      console.error('Failed to persist trust registry:', e);
    }
  }

  getAll(): TrustedDevice[] {
    return Array.from(this.devices.values());
  }

  get(deviceId: string): TrustedDevice | undefined {
    return this.devices.get(deviceId);
  }

  isTrusted(deviceId: string): boolean {
    const dev = this.devices.get(deviceId);
    return !!dev && dev.trustLevel === 'verified';
  }

  enroll(device: {
    id?: string;
    name: string;
    publicKeyJwk: JsonWebKey;
    trustLevel?: TrustLevel;
    notes?: string;
  }): TrustedDevice {
    const fingerprint = deriveFingerprint(device.publicKeyJwk);
    const id = device.id || fingerprint;
    const trusted: TrustedDevice = {
      id,
      name: device.name,
      fingerprint,
      publicKeyJwk: device.publicKeyJwk,
      trustLevel: device.trustLevel ?? 'verified',
      enrolledAt: Date.now(),
      notes: device.notes,
    };
    this.devices.set(id, trusted);
    this.save();
    return trusted;
  }

  updateTrust(deviceId: string, trustLevel: TrustLevel): boolean {
    const dev = this.devices.get(deviceId);
    if (!dev) return false;
    dev.trustLevel = trustLevel;
    this.save();
    return true;
  }

  remove(deviceId: string): boolean {
    const deleted = this.devices.delete(deviceId);
    if (deleted) this.save();
    return deleted;
  }
}

export const defaultTrustRegistry = new TrustRegistry();
