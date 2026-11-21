import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalJson } from '../src/security/canonical';
import {
  calculateDigest,
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  signData,
  verifySignature,
  deriveFingerprint,
} from '../src/security/crypto';
import {
  createEnvelope,
  verifyEnvelope,
} from '../src/security/envelope';
import { ReplayProtector } from '../src/security/replay';
import { TrustRegistry } from '../src/security/trust';
import { getStorage } from '../src/security/storage-helper';
import { AuditLedger } from '../src/storage/audit';
import { SonicDB } from '../src/storage/db';
import { RelayEngine, verifyRelayHop } from '../src/relay/relay-engine';
import { createDeliveryReceipt, verifyDeliveryReceipt, createRelayReceipt, verifyRelayReceipt } from '../src/relay/receipts';
import { AcousticBridge } from '../src/bridge/acoustic-bridge';
import { safeName, packContent, verifyContent, estimateTransfer } from '../src/content';
import { writeWav, readWav } from '../src/wav';
import { crc32, encodePacket, decodePacket, Kind } from '../src/protocol';
import type { SonicEnvelope } from '../src/types/envelope';

describe('Deep Backend Audit - Cryptographic Envelopes and Relay Chain', () => {
  beforeEach(() => {
    getStorage().clear();
  });

  it('preserves cryptographic validity when forwarded across multiple relay hops', async () => {
    const originKeys = await generateKeyPair();
    const relayBKeys = await generateKeyPair();
    const relayCKeys = await generateKeyPair();

    const originEnvelope = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'NODE-ORIGIN-A',
      originPublicKey: originKeys.publicKey,
      originPrivateKey: originKeys.privateKey,
      payload: { incidentId: 'FLOOD-77', victims: 12 },
      maxHops: 3,
    });

    // 1. Initial verification at origin
    const originCheck = await verifyEnvelope(originEnvelope);
    expect(originCheck.valid).toBe(true);

    // 2. Hop 1: Relayed by Node B
    const relayEngineB = new RelayEngine('NODE-RELAY-B');
    expect(relayEngineB.canRelay(originEnvelope).allowed).toBe(true);

    const forwardedB = await relayEngineB.prepareForward(originEnvelope, relayBKeys.privateKey);
    expect(forwardedB.hopCount).toBe(1);
    expect(forwardedB.relayHistory.length).toBe(1);
    expect(forwardedB.relayHistory[0].deviceId).toBe('NODE-RELAY-B');

    // The forwarded envelope MUST remain valid under verifyEnvelope!
    const forwardedBCheck = await verifyEnvelope(forwardedB);
    expect(forwardedBCheck.valid).toBe(true);

    // Verify intermediate hop signature
    const hopBValid = await verifyRelayHop(
      forwardedB.relayHistory[0],
      forwardedB.messageId,
      1,
      await exportPublicKey(relayBKeys.publicKey)
    );
    expect(hopBValid).toBe(true);

    // 3. Hop 2: Relayed by Node C
    const relayEngineC = new RelayEngine('NODE-RELAY-C');
    expect(relayEngineC.canRelay(forwardedB).allowed).toBe(true);

    const forwardedC = await relayEngineC.prepareForward(forwardedB, relayCKeys.privateKey);
    expect(forwardedC.hopCount).toBe(2);
    expect(forwardedC.relayHistory.length).toBe(2);

    const forwardedCCheck = await verifyEnvelope(forwardedC);
    expect(forwardedCCheck.valid).toBe(true);

    // 4. Max hops enforcement: if forwarded again past maxHops (3), relay should be refused
    const relayEngineD = new RelayEngine('NODE-RELAY-D');
    const forwardedD = await relayEngineD.prepareForward(forwardedC, relayBKeys.privateKey);
    expect(forwardedD.hopCount).toBe(3);

    const relayEngineE = new RelayEngine('NODE-RELAY-E');
    // At hopCount 3 with maxHops 3, cannot relay further
    expect(relayEngineE.canRelay(forwardedD).allowed).toBe(false);
  });

  it('rejects tampered hop counts or manipulated relay history', async () => {
    const originKeys = await generateKeyPair();
    const env = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'NODE-ORIGIN-A',
      originPublicKey: originKeys.publicKey,
      originPrivateKey: originKeys.privateKey,
      payload: { data: 'test' },
      maxHops: 2,
    });

    // Negative hopCount
    const negativeHop = { ...env, hopCount: -1 };
    expect((await verifyEnvelope(negativeHop)).valid).toBe(false);

    // Exceeded maxHops
    const excessHop = { ...env, hopCount: 5 };
    const excessCheck = await verifyEnvelope(excessHop);
    expect(excessCheck.valid).toBe(false);
    if (!excessCheck.valid) {
      expect(excessCheck.reason).toBe('HOP_LIMIT_EXCEEDED');
    }

    // Manipulated: history has 2 hops but declared hopCount is 1
    const manipulated = {
      ...env,
      hopCount: 1,
      relayHistory: [
        { deviceId: 'B', timestamp: Date.now(), signature: 'SIG1' },
        { deviceId: 'C', timestamp: Date.now(), signature: 'SIG2' },
      ],
    };
    const manipCheck = await verifyEnvelope(manipulated);
    expect(manipCheck.valid).toBe(false);
    if (!manipCheck.valid) {
      expect(manipCheck.reason).toBe('MALFORMED');
    }
  });

  it('prevents replay cache poisoning when unverified envelopes are received', async () => {
    const originKeys = await generateKeyPair();
    const forgedKeys = await generateKeyPair();
    const bridge = new AcousticBridge();
    bridge.setLocalIdentity('RECEIVER-NODE', originKeys.publicKey, originKeys.privateKey);

    // Valid envelope
    const { envelope: validEnv, packedBytes } = await bridge.composeAndQueue(
      'rescue_incident',
      { incidentId: 'LEGIT-01' }
    );

    // Construct a malicious forged envelope using the SAME messageId and nonce
    const forgedEnv: SonicEnvelope = {
      ...validEnv,
      payload: { incidentId: 'MALICIOUS-TAMPERED' },
      // Signature is made with forged key, so verification will fail
      signature: await signData(forgedKeys.privateKey, new Uint8Array([1, 2, 3])),
    };

    const forgedPacked = bridge.packEnvelope(forgedEnv);
    const verifiedForged = verifyContent(forgedPacked);

    // Process the forged envelope: must be rejected with SIGNATURE_FAILED or DIGEST_MISMATCH
    const forgedResult = await bridge.handleReceivedContent(verifiedForged);
    expect(forgedResult?.verification.valid).toBe(false);

    // Now send the LEGITIMATE original envelope: it MUST be accepted and NOT rejected as a replay!
    const verifiedLegit = verifyContent(packedBytes);
    const legitResult = await bridge.handleReceivedContent(verifiedLegit);
    expect(legitResult?.verification.valid).toBe(true);
    expect(legitResult?.isReplay).toBe(false);

    // If the legitimate envelope is received a second time, it MUST then be flagged as a replay!
    const secondLegitResult = await bridge.handleReceivedContent(verifiedLegit);
    expect(secondLegitResult?.isReplay).toBe(true);
  });
});

describe('Deep Backend Audit - Audit Ledger Cryptographic Chain', () => {
  it('detects tampering at any arbitrary block in the hash-linked chain', async () => {
    const db = new SonicDB();
    await db.clearAll();
    const ledger = new AuditLedger('AUDIT-TEST-NODE', db);

    // Log 5 distinct blocks
    for (let i = 0; i < 5; i++) {
      await ledger.logEvent('MESSAGE_COMPOSED', { seq: i, note: `Block ${i}` });
    }

    const initialCheck = await ledger.verifyIntegrity();
    expect(initialCheck.valid).toBe(true);

    // Tamper with Block 2 (middle of the chain)
    const entries = await db.getAllAudit();
    expect(entries.length).toBe(5);
    entries[2].details = { seq: 2, note: 'Tampered Block 2' };
    await db.addAudit(entries[2]);

    const tamperedCheck = await ledger.verifyIntegrity();
    expect(tamperedCheck.valid).toBe(false);
    expect(tamperedCheck.brokenAtIndex).toBe(2);
    expect(tamperedCheck.reason).toContain('Tampered hash at index 2');
  });

  it('detects omitted or reordered blocks in the chain', async () => {
    const db = new SonicDB();
    await db.clearAll();
    const ledger = new AuditLedger('AUDIT-SEQ-NODE', db);

    await ledger.logEvent('DEVICE_CREATED', { name: 'A' });
    await ledger.logEvent('MESSAGE_COMPOSED', { id: 1 });
    await ledger.logEvent('MESSAGE_TRANSMITTED', { id: 1 });

    const entries = await db.getAllAudit();
    // Tamper with prevHash pointer of block 1
    entries[1].prevHash = '0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff';
    await db.addAudit(entries[1]);

    const check = await ledger.verifyIntegrity();
    expect(check.valid).toBe(false);
    expect(check.brokenAtIndex).toBe(1);
    expect(check.reason).toContain('Previous hash pointer broken at index 1');
  });
});

describe('Deep Backend Audit - Content Packaging & Safe Name Sanitization', () => {
  it('strictly sanitizes dangerous paths, special characters, and Windows device names', () => {
    expect(safeName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeName('..\\..\\windows\\system32\\cmd.exe')).toBe('_.._windows_system32_cmd.exe');
    expect(safeName('CON.txt')).toBe('_CON.txt');
    expect(safeName('aux.json')).toBe('_aux.json');
    expect(safeName('NUL')).toBe('_NUL');
    expect(safeName('COM1.log')).toBe('_COM1.log');
    expect(safeName('   spaces_around.txt   ')).toBe('spaces_around.txt');
    expect(safeName('...dots...')).toBe('dots');
    expect(safeName('valid-doc_2026.pdf')).toBe('valid-doc_2026.pdf');
    expect(safeName('')).toBe('attachment');
  });

  it('rejects content exceeding the 4096-byte acoustic frame capacity', () => {
    const hugePayload = new Uint8Array(4100);
    expect(() => {
      packContent('file', 'large.bin', hugePayload);
    }).toThrow(/exceed the 4096-byte transfer limit/);
  });

  it('verifies content integrity and rejects corrupted payload digests', () => {
    const originalText = 'Crucial acoustic emergency telemetry packet';
    const textBytes = new TextEncoder().encode(originalText);
    const packed = packContent('text', 'emergency.txt', textBytes);

    const verified = verifyContent(packed);
    expect(verified.name).toBe('emergency.txt');
    expect(verified.kind).toBe('text');
    expect(verified.text).toBe(originalText);

    // Corrupt one byte of content
    const corrupted = new Uint8Array(packed);
    corrupted[corrupted.length - 1] ^= 0xff;

    expect(() => {
      verifyContent(corrupted);
    }).toThrow(/Whole-file SHA-256 mismatch/);
  });
});

describe('Deep Backend Audit - WAV Audio Parser & Generator', () => {
  it('correctly round-trips synthetic Float32 audio to mono 16-bit PCM WAV', () => {
    const sampleRate = 48000;
    const durationSec = 0.05; // 50ms
    const numSamples = Math.floor(sampleRate * durationSec);
    const originalPcm = new Float32Array(numSamples);

    // Generate 1 kHz sine wave
    for (let i = 0; i < numSamples; i++) {
      originalPcm[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.8;
    }

    const wavBuffer = writeWav(originalPcm, sampleRate);
    expect(wavBuffer.byteLength).toBe(44 + numSamples * 2);

    const parsed = readWav(wavBuffer);
    expect(parsed.sampleRate).toBe(sampleRate);
    expect(parsed.pcm.length).toBe(numSamples);

    // Quantization error for 16-bit PCM should be < 1/32767 ≈ 0.0001
    for (let i = 0; i < numSamples; i++) {
      expect(Math.abs(parsed.pcm[i] - originalPcm[i])).toBeLessThan(0.001);
    }
  });

  it('rejects malformed or invalid WAV headers', () => {
    // Too short
    expect(() => readWav(new ArrayBuffer(30))).toThrow(/Invalid WAV/);

    // Corrupted magic
    const fakeBuffer = new ArrayBuffer(44);
    expect(() => readWav(fakeBuffer)).toThrow(/Invalid WAV/);
  });
});

describe('Deep Backend Audit - Receipts and Protocol Framing', () => {
  it('creates and verifies cryptographic relay receipts', async () => {
    const keyPair = await generateKeyPair();
    const jwk = await exportPublicKey(keyPair.publicKey);

    const receipt = await createRelayReceipt('msg_target_777', 'NODE_RELAY_B', keyPair.privateKey, 1);
    expect(receipt.originalMessageId).toBe('msg_target_777');
    expect(receipt.relayedByDeviceId).toBe('NODE_RELAY_B');
    expect(receipt.hopNumber).toBe(1);

    const valid = await verifyRelayReceipt(receipt, jwk);
    expect(valid).toBe(true);

    // Tamper with receipt
    const tamperedReceipt = { ...receipt, hopNumber: 2 };
    const invalid = await verifyRelayReceipt(tamperedReceipt, jwk);
    expect(invalid).toBe(false);
  });

  it('encodes and decodes low-level framing with CRC32 integrity check', () => {
    const payload = new Uint8Array([10, 20, 30, 40, 50]);
    const maxPacket = 140;

    const packet = {
      kind: Kind.DATA,
      session: 0x12345678,
      transfer: 0x87654321,
      seq: 2,
      payload,
    };

    const encoded = encodePacket(packet, maxPacket);
    expect(encoded.length).toBe(16 + payload.length + 4); // 16B header + payload + 4B CRC32

    const decoded = decodePacket(encoded, maxPacket);
    expect(decoded.kind).toBe(Kind.DATA);
    expect(decoded.session).toBe(0x12345678);
    expect(decoded.transfer).toBe(0x87654321);
    expect(decoded.seq).toBe(2);
    expect(Array.from(decoded.payload)).toEqual(Array.from(payload));

    // Tamper with one byte in the frame
    encoded[10] ^= 0x01;
    expect(() => decodePacket(encoded, maxPacket)).toThrow(/CRC32 mismatch/);
  });
});
