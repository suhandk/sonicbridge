export type MessageType =
  | 'rescue_incident'
  | 'airgap_package'
  | 'airgap_approval'
  | 'trace_handover'
  | 'trace_acceptance'
  | 'delivery_receipt'
  | 'relay_forward';

export type TransferStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'SIGNED'
  | 'QUEUED'
  | 'NEGOTIATING'
  | 'TRANSMITTING'
  | 'TRANSPORT_ACKNOWLEDGED'
  | 'RECEIVING'
  | 'INTEGRITY_VERIFIED'
  | 'SIGNATURE_VERIFIED'
  | 'APPLICATION_ACCEPTED'
  | 'RECEIPT_SENT'
  | 'DELIVERED'
  | 'RELAY_PENDING'
  | 'RELAYED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CANCELLED';

export interface RelayHop {
  deviceId: string;
  timestamp: number;
  signature: string;
}

export interface RelayReceipt {
  receiptId: string;
  originalMessageId: string;
  relayedByDeviceId: string;
  relayedAt: number;
  hopNumber: number;
  signature: string;
}

export interface DeliveryReceipt {
  receiptId: string;
  messageId: string;
  acceptedByDeviceId: string;
  acceptedAt: number;
  status: 'ACCEPTED' | 'REJECTED';
  reason?: string;
  signature: string;
}

export interface SonicEnvelope<T = unknown> {
  version: 1;
  messageId: string;
  originDeviceId: string;
  originPublicKeyJwk: JsonWebKey;
  messageType: MessageType;
  createdAt: number;
  expiresAt: number;
  nonce: string;
  payload: T;
  payloadDigestSha256: string; // hex
  signature: string; // base64 ECDSA
  hopCount: number;
  maxHops: number;
  relayHistory: RelayHop[];
}
