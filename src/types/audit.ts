export interface AuditEntry {
  index: number;
  timestamp: number;
  eventType:
    | 'DEVICE_CREATED'
    | 'PEER_ENROLLED'
    | 'MESSAGE_COMPOSED'
    | 'MESSAGE_TRANSMITTED'
    | 'MESSAGE_RECEIVED'
    | 'SIGNATURE_VERIFIED'
    | 'SIGNATURE_FAILED'
    | 'REPLAY_REJECTED'
    | 'EXPIRATION_REJECTED'
    | 'RELAY_FORWARDED'
    | 'DELIVERY_ACCEPTED'
    | 'DELIVERY_REJECTED'
    | 'CONFIG_APPROVED'
    | 'CONFIG_REJECTED'
    | 'HANDOVER_COMPLETED';
  deviceId: string;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface ExportData {
  exportedAt: number;
  deviceId: string;
  totalEntries: number;
  entries: AuditEntry[];
}
