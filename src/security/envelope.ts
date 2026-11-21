import { calculateDigest, exportPublicKey, deriveFingerprint, importPublicKey, signData, verifySignature } from './crypto';
import { canonicalJson } from './canonical';
import type { SonicEnvelope, MessageType, RelayHop } from '../types/envelope';

const textEncoder = new TextEncoder();

export function getCanonicalSignableData(env: Omit<SonicEnvelope, 'signature' | 'relayHistory'>): Uint8Array {
  // Canonical representation of all immutable envelope fields
  const signable = {
    version: env.version,
    messageId: env.messageId,
    originDeviceId: env.originDeviceId,
    messageType: env.messageType,
    createdAt: env.createdAt,
    expiresAt: env.expiresAt,
    nonce: env.nonce,
    payloadDigestSha256: env.payloadDigestSha256,
    hopCount: env.hopCount,
    maxHops: env.maxHops,
  };
  return textEncoder.encode(canonicalJson(signable));
}

export function generateNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface EnvelopeCreationOptions {
  messageType: MessageType;
  originDeviceId: string;
  originPublicKey: CryptoKey;
  originPrivateKey: CryptoKey;
  payload: unknown;
  expiresInMs?: number;
  maxHops?: number;
}

export async function createEnvelope<T>(options: EnvelopeCreationOptions): Promise<SonicEnvelope<T>> {
  const now = Date.now();
  const originPublicKeyJwk = await exportPublicKey(options.originPublicKey);
  const payloadDigest = calculateDigest(options.payload);
  const nonce = generateNonce();
  const messageId = `msg_${now.toString(36)}_${nonce.slice(0, 8)}`;

  const baseEnvelope: Omit<SonicEnvelope<T>, 'signature' | 'relayHistory'> = {
    version: 1,
    messageId,
    originDeviceId: options.originDeviceId,
    originPublicKeyJwk,
    messageType: options.messageType,
    createdAt: now,
    expiresAt: now + (options.expiresInMs ?? 1000 * 60 * 60 * 24), // 24 hours default
    nonce,
    payload: options.payload as T,
    payloadDigestSha256: payloadDigest,
    hopCount: 0,
    maxHops: options.maxHops ?? 3,
  };

  const signableBytes = getCanonicalSignableData(baseEnvelope as Omit<SonicEnvelope, 'signature' | 'relayHistory'>);
  const signature = await signData(options.originPrivateKey, signableBytes);

  return {
    ...baseEnvelope,
    signature,
    relayHistory: [],
  };
}

export type VerificationResult =
  | { valid: true; senderFingerprint: string }
  | { valid: false; reason: 'EXPIRED' | 'DIGEST_MISMATCH' | 'INVALID_SIGNATURE' | 'HOP_LIMIT_EXCEEDED' | 'MALFORMED' | 'UNSUPPORTED_VERSION'; detail: string };

export async function verifyEnvelope(envelope: SonicEnvelope, now: number = Date.now()): Promise<VerificationResult> {
  try {
    if (!envelope || envelope.version !== 1) {
      return { valid: false, reason: 'UNSUPPORTED_VERSION', detail: 'Unsupported envelope schema version.' };
    }

    // 1. Check expiration
    if (envelope.expiresAt <= now) {
      return {
        valid: false,
        reason: 'EXPIRED',
        detail: `Message expired at ${new Date(envelope.expiresAt).toISOString()} (current: ${new Date(now).toISOString()}).`,
      };
    }

    // 2. Check hop limits
    if (envelope.hopCount > envelope.maxHops) {
      return {
        valid: false,
        reason: 'HOP_LIMIT_EXCEEDED',
        detail: `Message hop count (${envelope.hopCount}) exceeds max allowable hops (${envelope.maxHops}).`,
      };
    }

    // 3. Check payload digest integrity
    const computedDigest = calculateDigest(envelope.payload);
    if (computedDigest !== envelope.payloadDigestSha256) {
      return {
        valid: false,
        reason: 'DIGEST_MISMATCH',
        detail: `Payload digest mismatch: computed ${computedDigest.slice(0, 8)}... vs declared ${envelope.payloadDigestSha256.slice(0, 8)}...`,
      };
    }

    // 4. Verify cryptographic signature
    const publicKey = await importPublicKey(envelope.originPublicKeyJwk);
    const signableBytes = getCanonicalSignableData(envelope as Omit<SonicEnvelope, 'signature' | 'relayHistory'>);
    const sigValid = await verifySignature(publicKey, envelope.signature, signableBytes);

    if (!sigValid) {
      return {
        valid: false,
        reason: 'INVALID_SIGNATURE',
        detail: 'Digital signature verification failed. Message may have been altered in transit.',
      };
    }

    const senderFingerprint = deriveFingerprint(envelope.originPublicKeyJwk);
    return { valid: true, senderFingerprint };
  } catch (err) {
    return { valid: false, reason: 'MALFORMED', detail: String(err) };
  }
}
