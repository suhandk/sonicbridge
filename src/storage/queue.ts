import type { SonicEnvelope, TransferStatus } from '../types/envelope';
import { defaultDb, SonicDB, StoredMessage } from './db';

export class MessageQueueManager {
  private db: SonicDB;
  private listeners = new Set<() => void>();

  constructor(db = defaultDb) {
    this.db = db;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('Queue listener error:', err);
      }
    }
  }

  async enqueue(envelope: SonicEnvelope): Promise<StoredMessage> {
    const msg: StoredMessage = {
      envelope,
      status: 'QUEUED',
      updatedAt: Date.now(),
    };
    await this.db.saveOutgoing(msg);
    this.notify();
    return msg;
  }

  async updateStatus(
    messageId: string,
    status: TransferStatus,
    statusDetail?: string,
    deliveryReceipt?: unknown
  ): Promise<StoredMessage | undefined> {
    const msg = await this.db.getOutgoing(messageId);
    if (!msg) return undefined;
    msg.status = status;
    msg.statusDetail = statusDetail;
    msg.updatedAt = Date.now();
    if (deliveryReceipt !== undefined) msg.deliveryReceipt = deliveryReceipt;
    await this.db.saveOutgoing(msg);
    this.notify();
    return msg;
  }

  async getPending(): Promise<StoredMessage[]> {
    const all = await this.db.getAllOutgoing();
    return all.filter(m => m.status === 'QUEUED' || m.status === 'TRANSMITTING');
  }

  async getAll(): Promise<StoredMessage[]> {
    return await this.db.getAllOutgoing();
  }
}

export const defaultQueueManager = new MessageQueueManager();
