import type { SonicEnvelope, TransferStatus } from '../types/envelope';
import type { AuditEntry } from '../types/audit';

export interface StoredMessage {
  envelope: SonicEnvelope;
  status: TransferStatus;
  statusDetail?: string;
  updatedAt: number;
  deliveryReceipt?: unknown;
}

const DB_NAME = 'SonicBridgeOfflineDB';
const DB_VERSION = 1;

export class SonicDB {
  private dbPromise: Promise<IDBDatabase> | null = null;
  // In-memory fallback if IndexedDB is entirely unavailable
  private memIncoming = new Map<string, StoredMessage>();
  private memOutgoing = new Map<string, StoredMessage>();
  private memRelay = new Map<string, StoredMessage>();
  private memAudit: AuditEntry[] = [];
  private useMemory = false;

  constructor() {
    this.init();
  }

  private async init() {
    if (typeof indexedDB === 'undefined') {
      try {
        const fake = await import('fake-indexeddb');
        if (fake && fake.indexedDB) {
          (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = fake.indexedDB;
        } else {
          this.useMemory = true;
          return;
        }
      } catch {
        this.useMemory = true;
        return;
      }
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        console.warn('IndexedDB failed to open, falling back to in-memory store:', request.error);
        this.useMemory = true;
        resolve(null as unknown as IDBDatabase);
      };
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('messages_incoming')) {
          const store = db.createObjectStore('messages_incoming', { keyPath: 'envelope.messageId' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('messages_outgoing')) {
          const store = db.createObjectStore('messages_outgoing', { keyPath: 'envelope.messageId' });
          store.createIndex('updatedAt', 'updatedAt');
          store.createIndex('status', 'status');
        }
        if (!db.objectStoreNames.contains('relay_queue')) {
          const store = db.createObjectStore('relay_queue', { keyPath: 'envelope.messageId' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('audit_entries')) {
          const store = db.createObjectStore('audit_entries', { keyPath: 'index' });
          store.createIndex('timestamp', 'timestamp');
        }
      };
    });
  }

  private async getDB(): Promise<IDBDatabase | null> {
    if (this.useMemory) return null;
    return this.dbPromise;
  }

  // --- Outgoing Messages ---
  async saveOutgoing(msg: StoredMessage): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.memOutgoing.set(msg.envelope.messageId, msg);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages_outgoing', 'readwrite');
      tx.objectStore('messages_outgoing').put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getOutgoing(messageId: string): Promise<StoredMessage | undefined> {
    const db = await this.getDB();
    if (!db) return this.memOutgoing.get(messageId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages_outgoing', 'readonly');
      const req = tx.objectStore('messages_outgoing').get(messageId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllOutgoing(): Promise<StoredMessage[]> {
    const db = await this.getDB();
    if (!db) return Array.from(this.memOutgoing.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages_outgoing', 'readonly');
      const req = tx.objectStore('messages_outgoing').getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a: StoredMessage, b: StoredMessage) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  }

  // --- Incoming Messages ---
  async saveIncoming(msg: StoredMessage): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.memIncoming.set(msg.envelope.messageId, msg);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages_incoming', 'readwrite');
      tx.objectStore('messages_incoming').put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getIncoming(messageId: string): Promise<StoredMessage | undefined> {
    const db = await this.getDB();
    if (!db) return this.memIncoming.get(messageId);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages_incoming', 'readonly');
      const req = tx.objectStore('messages_incoming').get(messageId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getAllIncoming(): Promise<StoredMessage[]> {
    const db = await this.getDB();
    if (!db) return Array.from(this.memIncoming.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('messages_incoming', 'readonly');
      const req = tx.objectStore('messages_incoming').getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a: StoredMessage, b: StoredMessage) => b.updatedAt - a.updatedAt));
      req.onerror = () => reject(req.error);
    });
  }

  // --- Relay Queue ---
  async enqueueRelay(msg: StoredMessage): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.memRelay.set(msg.envelope.messageId, msg);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('relay_queue', 'readwrite');
      tx.objectStore('relay_queue').put(msg);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async dequeueRelay(messageId: string): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      this.memRelay.delete(messageId);
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('relay_queue', 'readwrite');
      tx.objectStore('relay_queue').delete(messageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllRelay(): Promise<StoredMessage[]> {
    const db = await this.getDB();
    if (!db) return Array.from(this.memRelay.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('relay_queue', 'readonly');
      const req = tx.objectStore('relay_queue').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Audit Entries ---
  async addAudit(entry: AuditEntry): Promise<void> {
    const db = await this.getDB();
    if (!db) {
      const existingIdx = this.memAudit.findIndex(e => e.index === entry.index);
      if (existingIdx >= 0) {
        this.memAudit[existingIdx] = entry;
      } else {
        this.memAudit.push(entry);
      }
      return;
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audit_entries', 'readwrite');
      tx.objectStore('audit_entries').put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllAudit(): Promise<AuditEntry[]> {
    const db = await this.getDB();
    if (!db) return [...this.memAudit].sort((a, b) => a.index - b.index);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('audit_entries', 'readonly');
      const req = tx.objectStore('audit_entries').getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a: AuditEntry, b: AuditEntry) => a.index - b.index));
      req.onerror = () => reject(req.error);
    });
  }

  async clearAll(): Promise<void> {
    this.memIncoming.clear();
    this.memOutgoing.clear();
    this.memRelay.clear();
    this.memAudit = [];
    const db = await this.getDB();
    if (!db) return;
    return new Promise((resolve, reject) => {
      const stores = ['messages_incoming', 'messages_outgoing', 'relay_queue', 'audit_entries'];
      const tx = db.transaction(stores, 'readwrite');
      for (const s of stores) tx.objectStore(s).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const defaultDb = new SonicDB();
