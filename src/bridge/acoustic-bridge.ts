import { canonicalJson } from '../security/canonical';
import { createEnvelope, verifyEnvelope, type VerificationResult } from '../security/envelope';
import { defaultReplayProtector } from '../security/replay';
import { defaultTrustRegistry } from '../security/trust';
import { defaultAuditLedger } from '../storage/audit';
import { defaultDb, StoredMessage } from '../storage/db';
import { defaultQueueManager } from '../storage/queue';
import { defaultRelayEngine } from '../relay/relay-engine';
import { createDeliveryReceipt } from '../relay/receipts';
import { packContent, verifyContent, type VerifiedContent } from '../content';
import { MAX_TRANSFER_BYTES } from '../protocol';
import type { SonicEnvelope, MessageType, TransferStatus } from '../types/envelope';
import type { StopAndWait } from '../transport';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
export const SONIC_ENVELOPE_FILENAME = 'sb-msg.json';

export interface EnvelopeReceiveEvent {
  envelope: SonicEnvelope;
  verification: VerificationResult;
  isReplay: boolean;
  isTrustedSender: boolean;
  senderFingerprint?: string;
  error?: string;
}

export class AcousticBridge {
  private currentDeviceId: string = 'unknown_node';
  private privateKey?: CryptoKey;
  private publicKey?: CryptoKey;
  private transport?: StopAndWait;
  private onMessageReceived?: (event: EnvelopeReceiveEvent) => void;

  setLocalIdentity(deviceId: string, publicKey: CryptoKey, privateKey: CryptoKey) {
    this.currentDeviceId = deviceId;
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    defaultAuditLedger.setDeviceId(deviceId);
    defaultRelayEngine.setDeviceId(deviceId);
  }

  attachTransport(transport: StopAndWait, onMessageReceived?: (event: EnvelopeReceiveEvent) => void) {
    this.transport = transport;
    this.onMessageReceived = onMessageReceived;
  }

  /**
   * Serializes and packs a SonicEnvelope into acoustic transmission bytes.
   */
  packEnvelope(envelope: SonicEnvelope): Uint8Array {
    const jsonStr = canonicalJson(envelope);
    const payloadBytes = textEncoder.encode(jsonStr);

    if (payloadBytes.length > MAX_TRANSFER_BYTES - 100) {
      throw new Error(`Envelope exceeds safe acoustic size (${payloadBytes.length} bytes; limit is 4000)`);
    }

    return packContent('text', SONIC_ENVELOPE_FILENAME, payloadBytes);
  }

  /**
   * Composes, signs, queues, and prepares transmission bytes for any scenario payload.
   */
  async composeAndQueue<T>(
    messageType: MessageType,
    payload: T,
    expiresInMs?: number,
    maxHops = 3
  ): Promise<{ envelope: SonicEnvelope<T>; packedBytes: Uint8Array }> {
    if (!this.publicKey || !this.privateKey) {
      throw new Error('Local cryptographic identity not initialized.');
    }

    const envelope = await createEnvelope<T>({
      messageType,
      originDeviceId: this.currentDeviceId,
      originPublicKey: this.publicKey,
      originPrivateKey: this.privateKey,
      payload,
      expiresInMs,
      maxHops,
    });

    const packedBytes = this.packEnvelope(envelope as unknown as SonicEnvelope);

    // Queue in persistence
    await defaultQueueManager.enqueue(envelope as unknown as SonicEnvelope);

    // Log to hash-linked audit ledger
    await defaultAuditLedger.logEvent('MESSAGE_COMPOSED', {
      messageId: envelope.messageId,
      messageType: envelope.messageType,
      sizeBytes: packedBytes.length,
    });

    return { envelope, packedBytes };
  }

  /**
   * Processes verified content emitted by StopAndWait.
   */
  async handleReceivedContent(item: VerifiedContent): Promise<EnvelopeReceiveEvent | null> {
    if (item.kind !== 'text' || !item.text) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(item.text);
    } catch {
      return null;
    }

    const envelope = parsed as SonicEnvelope;
    if (!envelope || envelope.version !== 1 || !envelope.messageId || !envelope.signature) {
      return null;
    }

    // 1. Cryptographic verification
    const verification = await verifyEnvelope(envelope);
    const isTrustedSender = defaultTrustRegistry.isTrusted(envelope.originDeviceId);

    // 2. Replay check (only record into stateful cache if signature is valid)
    let isReplay = false;
    let replayReason: string | undefined;

    if (verification.valid) {
      const replayCheck = defaultReplayProtector.checkAndRecord(
        envelope.messageId,
        envelope.originDeviceId,
        envelope.nonce
      );
      isReplay = replayCheck.isReplay;
      replayReason = replayCheck.reason;
    }

    let status: TransferStatus = 'APPLICATION_ACCEPTED';
    let statusDetail = 'Verified and accepted.';

    if (!verification.valid) {
      status = 'REJECTED';
      statusDetail = `Security failure: ${verification.reason} - ${verification.detail}`;
      await defaultAuditLedger.logEvent('SIGNATURE_FAILED', {
        messageId: envelope.messageId,
        reason: verification.reason,
        detail: verification.detail,
      });
    } else if (isReplay) {
      status = 'REJECTED';
      statusDetail = `Security failure: ${replayReason}`;
      await defaultAuditLedger.logEvent('REPLAY_REJECTED', {
        messageId: envelope.messageId,
        reason: replayReason,
      });
    } else {
      await defaultAuditLedger.logEvent('MESSAGE_RECEIVED', {
        messageId: envelope.messageId,
        messageType: envelope.messageType,
        originDeviceId: envelope.originDeviceId,
        senderTrusted: isTrustedSender,
      });
    }

    const storedMsg: StoredMessage = {
      envelope,
      status,
      statusDetail,
      updatedAt: Date.now(),
    };
    await defaultDb.saveIncoming(storedMsg);

    // If valid, consider relaying
    if (verification.valid && !isReplay) {
      const relayDecision = defaultRelayEngine.canRelay(envelope);
      if (relayDecision.allowed) {
        await defaultRelayEngine.queueForRelay(envelope);
        await defaultAuditLedger.logEvent('RELAY_FORWARDED', {
          messageId: envelope.messageId,
          hopCount: envelope.hopCount + 1,
        });
      }
    }

    const event: EnvelopeReceiveEvent = {
      envelope,
      verification,
      isReplay,
      isTrustedSender,
      senderFingerprint: verification.valid ? verification.senderFingerprint : undefined,
      error: !verification.valid ? verification.detail : isReplay ? replayReason : undefined,
    };

    this.onMessageReceived?.(event);
    return event;
  }
}

export const defaultAcousticBridge = new AcousticBridge();
