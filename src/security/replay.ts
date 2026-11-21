import { getStorage } from './storage-helper';

const STORAGE_KEY_REPLAY = 'sonicbridge_replay_cache';

export interface ReplayEntry {
  messageId: string;
  nonceKey: string; // `${originDeviceId}:${nonce}`
  recordedAt: number;
}

export class ReplayProtector {
  private cache = new Map<string, ReplayEntry>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = 1000 * 60 * 60 * 48) { // 48h retention
    this.maxAgeMs = maxAgeMs;
    this.load();
  }

  private load() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY_REPLAY);
      if (raw) {
        const list = JSON.parse(raw) as ReplayEntry[];
        const now = Date.now();
        this.cache.clear();
        for (const item of list) {
          if (now - item.recordedAt < this.maxAgeMs) {
            this.cache.set(item.messageId, item);
            this.cache.set(item.nonceKey, item);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load replay cache:', e);
    }
  }

  private save() {
    try {
      const entries = Array.from(new Set(this.cache.values()));
      getStorage().setItem(STORAGE_KEY_REPLAY, JSON.stringify(entries));
    } catch (e) {
      console.error('Failed to persist replay cache:', e);
    }
  }

  /**
   * Checks if messageId or nonce has already been seen.
   * If not seen, records it and returns { isReplay: false }.
   * If seen, returns { isReplay: true, reason: string }.
   */
  checkAndRecord(messageId: string, originDeviceId: string, nonce: string): { isReplay: boolean; reason?: string } {
    const nonceKey = `${originDeviceId}:${nonce}`;
    if (this.cache.has(messageId)) {
      return { isReplay: true, reason: `Duplicate message ID (${messageId}) detected.` };
    }
    if (this.cache.has(nonceKey)) {
      return { isReplay: true, reason: `Replayed nonce (${nonce}) from sender ${originDeviceId} detected.` };
    }

    const entry: ReplayEntry = {
      messageId,
      nonceKey,
      recordedAt: Date.now(),
    };
    this.cache.set(messageId, entry);
    this.cache.set(nonceKey, entry);
    this.save();
    return { isReplay: false };
  }

  has(messageId: string): boolean {
    return this.cache.has(messageId);
  }

  prune(now = Date.now()) {
    let changed = false;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.recordedAt >= this.maxAgeMs) {
        this.cache.delete(key);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

export const defaultReplayProtector = new ReplayProtector();
