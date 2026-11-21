import { canonicalJson } from '../security/canonical';
import { signData, verifySignature, importPublicKey } from '../security/crypto';
import type { DeliveryReceipt, RelayReceipt } from '../types/envelope';

const textEncoder = new TextEncoder();

export async function createDeliveryReceipt(
  messageId: string,
  acceptedByDeviceId: string,
  privateKey: CryptoKey,
  status: 'ACCEPTED' | 'REJECTED' = 'ACCEPTED',
  reason?: string
): Promise<DeliveryReceipt> {
  const receiptId = `rcpt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const acceptedAt = Date.now();

  const signable = {
    receiptId,
    messageId,
    acceptedByDeviceId,
    acceptedAt,
    status,
    reason,
  };

  const signableBytes = textEncoder.encode(canonicalJson(signable));
  const signature = await signData(privateKey, signableBytes);

  return {
    receiptId,
    messageId,
    acceptedByDeviceId,
    acceptedAt,
    status,
    reason,
    signature,
  };
}

export async function verifyDeliveryReceipt(
  receipt: DeliveryReceipt,
  signerPublicKeyJwk: JsonWebKey
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey(signerPublicKeyJwk);
    const signable = {
      receiptId: receipt.receiptId,
      messageId: receipt.messageId,
      acceptedByDeviceId: receipt.acceptedByDeviceId,
      acceptedAt: receipt.acceptedAt,
      status: receipt.status,
      reason: receipt.reason,
    };
    const signableBytes = textEncoder.encode(canonicalJson(signable));
    return await verifySignature(publicKey, receipt.signature, signableBytes);
  } catch {
    return false;
  }
}

export async function createRelayReceipt(
  originalMessageId: string,
  relayedByDeviceId: string,
  privateKey: CryptoKey,
  hopNumber: number
): Promise<RelayReceipt> {
  const receiptId = `relay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const relayedAt = Date.now();

  const signable = {
    receiptId,
    originalMessageId,
    relayedByDeviceId,
    relayedAt,
    hopNumber,
  };

  const signableBytes = textEncoder.encode(canonicalJson(signable));
  const signature = await signData(privateKey, signableBytes);

  return {
    receiptId,
    originalMessageId,
    relayedByDeviceId,
    relayedAt,
    hopNumber,
    signature,
  };
}

export async function verifyRelayReceipt(
  receipt: RelayReceipt,
  signerPublicKeyJwk: JsonWebKey
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey(signerPublicKeyJwk);
    const signable = {
      receiptId: receipt.receiptId,
      originalMessageId: receipt.originalMessageId,
      relayedByDeviceId: receipt.relayedByDeviceId,
      relayedAt: receipt.relayedAt,
      hopNumber: receipt.hopNumber,
    };
    const signableBytes = textEncoder.encode(canonicalJson(signable));
    return await verifySignature(publicKey, receipt.signature, signableBytes);
  } catch {
    return false;
  }
}
