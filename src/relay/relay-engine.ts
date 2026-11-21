import { canonicalJson } from '../security/canonical';
import { signData, verifySignature, importPublicKey } from '../security/crypto';
import type { SonicEnvelope, RelayHop } from '../types/envelope';
import { defaultDb, SonicDB } from '../storage/db';

const textEncoder = new TextEncoder();

export interface RelayDecision {
  allowed: boolean;
  reason?: string;
}

export class RelayEngine {
  private db: SonicDB;
  private currentDeviceId: string;

  constructor(currentDeviceId = 'unknown_node', db = defaultDb) {
    this.currentDeviceId = currentDeviceId;
    this.db = db;
  }

  setDeviceId(deviceId: string) {
    this.currentDeviceId = deviceId;
  }

  /**
   * Evaluates whether a received envelope is eligible for multi-hop store-and-forward.
   * Enforces hop limit, loop prevention, and expiration checks.
   */
  canRelay(envelope: SonicEnvelope, now = Date.now()): RelayDecision {
    // 1. Hop limit check
    if (envelope.hopCount >= envelope.maxHops) {
      return { allowed: false, reason: `Max hops (${envelope.maxHops}) reached.` };
    }

    // 2. Loop prevention: check origin
    if (envelope.originDeviceId === this.currentDeviceId) {
      return { allowed: false, reason: 'Originates from this device; looping prevented.' };
    }

    // 3. Loop prevention: check previous relay history
    if (envelope.relayHistory.some(h => h.deviceId === this.currentDeviceId)) {
      return { allowed: false, reason: 'Already traversed this node; relay loop prevented.' };
    }

    // 4. Expiration check
    if (envelope.expiresAt <= now) {
      return { allowed: false, reason: 'Message is expired.' };
    }

    return { allowed: true };
  }

  /**
   * Prepares a new forwarded copy of the envelope:
   * - Increments hopCount
   * - Creates and appends a signed RelayHop by this device
   * - Preserves the ORIGINAL payload and origin signature without any modification!
   */
  async prepareForward(envelope: SonicEnvelope, privateKey: CryptoKey): Promise<SonicEnvelope> {
    const hopNumber = envelope.hopCount + 1;
    const timestamp = Date.now();

    const hopSignable = {
      messageId: envelope.messageId,
      relayedBy: this.currentDeviceId,
      hopNumber,
      timestamp,
    };

    const signature = await signData(privateKey, textEncoder.encode(canonicalJson(hopSignable)));

    const newHop: RelayHop = {
      deviceId: this.currentDeviceId,
      timestamp,
      signature,
    };

    const forwarded: SonicEnvelope = {
      ...envelope,
      hopCount: hopNumber,
      relayHistory: [...envelope.relayHistory, newHop],
    };

    return forwarded;
  }

  /**
   * Queues an envelope for relay transmission.
   */
  async queueForRelay(envelope: SonicEnvelope): Promise<void> {
    await this.db.enqueueRelay({
      envelope,
      status: 'RELAY_PENDING',
      updatedAt: Date.now(),
    });
  }

  async getPendingRelays() {
    return await this.db.getAllRelay();
  }

  async markRelayed(messageId: string) {
    await this.db.dequeueRelay(messageId);
  }
}

export const defaultRelayEngine = new RelayEngine();
