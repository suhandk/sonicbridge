import { describe, it, expect, beforeEach } from 'vitest';
import { SonicDB } from '../src/storage/db';
import { AuditLedger } from '../src/storage/audit';
import { createDeliveryReceipt, verifyDeliveryReceipt } from '../src/relay/receipts';
import { RelayEngine } from '../src/relay/relay-engine';
import { generateKeyPair, exportPublicKey } from '../src/security/crypto';
import { createEnvelope } from '../src/security/envelope';
import type { SonicEnvelope } from '../src/types/envelope';

describe('Offline Storage and DB Operations', () => {
  let db: SonicDB;

  beforeEach(async () => {
    db = new SonicDB();
    await db.clearAll();
  });

  it('stores and retrieves incoming and outgoing messages with status tracking', async () => {
    const keyPair = await generateKeyPair();
    const env = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'dev_alpha',
      originPublicKey: keyPair.publicKey,
      originPrivateKey: keyPair.privateKey,
      payload: { id: 1 },
    });

    await db.saveOutgoing({
      envelope: env,
      status: 'QUEUED',
      updatedAt: Date.now(),
    });

    const retrieved = await db.getOutgoing(env.messageId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.status).toBe('QUEUED');
    expect(retrieved?.envelope.messageId).toBe(env.messageId);

    const all = await db.getAllOutgoing();
    expect(all.length).toBe(1);
  });
});

describe('Cryptographic Hash-Linked Audit Ledger', () => {
  let db: SonicDB;
  let ledger: AuditLedger;

  beforeEach(async () => {
    db = new SonicDB();
    await db.clearAll();
    ledger = new AuditLedger('dev_local_test', db);
  });

  it('logs events with hash-linked chain and verifies integrity', async () => {
    await ledger.logEvent('DEVICE_CREATED', { name: 'Node 1' });
    await ledger.logEvent('MESSAGE_COMPOSED', { msgId: 'msg_01' });
    await ledger.logEvent('MESSAGE_TRANSMITTED', { msgId: 'msg_01' });

    const entries = await ledger.getEntries();
    expect(entries.length).toBe(3);
    expect(entries[0].index).toBe(0);
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);

    const check = await ledger.verifyIntegrity();
    expect(check.valid).toBe(true);
  });

  it('detects tampering in the audit chain', async () => {
    await ledger.logEvent('DEVICE_CREATED', { name: 'Node 1' });
    await ledger.logEvent('MESSAGE_COMPOSED', { msgId: 'msg_01' });

    const entries = await db.getAllAudit();
    // Tamper with the details of index 0
    entries[0].details = { name: 'Tampered Node' };
    // Overwrite in db
    await db.addAudit(entries[0]);

    const check = await ledger.verifyIntegrity();
    expect(check.valid).toBe(false);
  });

  it('exports audit ledger as JSON and CSV', async () => {
    await ledger.logEvent('DEVICE_CREATED', { name: 'Node Export' });
    const json = await ledger.exportJson();
    expect(json).toContain('Node Export');

    const csv = await ledger.exportCsv();
    expect(csv).toContain('DEVICE_CREATED');
  });
});

describe('Delivery Receipts and Multi-Hop Store-and-Forward Relay', () => {
  it('creates and verifies signed delivery receipts', async () => {
    const keyPair = await generateKeyPair();
    const jwk = await exportPublicKey(keyPair.publicKey);

    const receipt = await createDeliveryReceipt('msg_target_42', 'dev_receiver_99', keyPair.privateKey, 'ACCEPTED');
    expect(receipt.messageId).toBe('msg_target_42');
    expect(receipt.status).toBe('ACCEPTED');

    const valid = await verifyDeliveryReceipt(receipt, jwk);
    expect(valid).toBe(true);
  });

  it('enforces hop count limits and loop prevention in relay engine', async () => {
    const keyPair = await generateKeyPair();
    const env: SonicEnvelope = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'dev_origin_A',
      originPublicKey: keyPair.publicKey,
      originPrivateKey: keyPair.privateKey,
      payload: { test: 1 },
      maxHops: 2,
    });

    const relayB = new RelayEngine('dev_relay_B');
    const decisionB = relayB.canRelay(env);
    expect(decisionB.allowed).toBe(true);

    // Relay from B to C
    const forwardedB = await relayB.prepareForward(env, keyPair.privateKey);
    expect(forwardedB.hopCount).toBe(1);
    expect(forwardedB.relayHistory.length).toBe(1);
    expect(forwardedB.relayHistory[0].deviceId).toBe('dev_relay_B');

    // Loop prevention: Device A cannot relay its own message
    const relayA = new RelayEngine('dev_origin_A');
    expect(relayA.canRelay(forwardedB).allowed).toBe(false);

    // Loop prevention: Device B cannot relay again
    expect(relayB.canRelay(forwardedB).allowed).toBe(false);

    // Relay from C to D
    const relayC = new RelayEngine('dev_relay_C');
    const forwardedC = await relayC.prepareForward(forwardedB, keyPair.privateKey);
    expect(forwardedC.hopCount).toBe(2);

    // Max hops exceeded: device D cannot relay further
    const relayD = new RelayEngine('dev_relay_D');
    expect(relayD.canRelay(forwardedC).allowed).toBe(false);
  });
});
