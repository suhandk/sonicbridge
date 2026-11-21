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

describe('Cryptographic Security Engine', () => {
  it('produces identical canonical JSON regardless of object key order', () => {
    const a = { z: 1, a: 2, nested: { b: 3, a: 4 } };
    const b = { a: 2, nested: { a: 4, b: 3 }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(calculateDigest(a)).toBe(calculateDigest(b));
  });

  it('generates ECDSA P-256 keys, signs data, and verifies signatures', async () => {
    const keyPair = await generateKeyPair();
    const data = new TextEncoder().encode('Test acoustic message payload');
    const signature = await signData(keyPair.privateKey, data);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);

    const valid = await verifySignature(keyPair.publicKey, signature, data);
    expect(valid).toBe(true);

    const tamperedData = new TextEncoder().encode('Test acoustic message payload (tampered)');
    const invalid = await verifySignature(keyPair.publicKey, signature, tamperedData);
    expect(invalid).toBe(false);
  });

  it('exports and imports public keys in JWK format and derives fingerprints', async () => {
    const keyPair = await generateKeyPair();
    const jwk = await exportPublicKey(keyPair.publicKey);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');

    const imported = await importPublicKey(jwk);
    expect(imported.algorithm.name).toBe('ECDSA');

    const fingerprint = deriveFingerprint(jwk);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('SonicEnvelope Lifecycle and Verification', () => {
  it('creates and verifies a valid signed SonicEnvelope', async () => {
    const keyPair = await generateKeyPair();
    const payload = {
      incidentId: 'INC-991',
      priority: 'Critical',
      description: 'Flash flood at sector 4',
    };

    const envelope = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'dev_test_01',
      originPublicKey: keyPair.publicKey,
      originPrivateKey: keyPair.privateKey,
      payload,
    });

    expect(envelope.version).toBe(1);
    expect(envelope.messageId.startsWith('msg_')).toBe(true);
    expect(envelope.signature.length).toBeGreaterThan(0);

    const result = await verifyEnvelope(envelope);
    expect(result.valid).toBe(true);
  });

  it('rejects an envelope if the payload was modified (tampering detection)', async () => {
    const keyPair = await generateKeyPair();
    const envelope = await createEnvelope({
      messageType: 'airgap_package',
      originDeviceId: 'dev_airgap_01',
      originPublicKey: keyPair.publicKey,
      originPrivateKey: keyPair.privateKey,
      payload: { packageId: 'PKG-100', version: '1.0.0' },
    });

    // Tamper with payload
    const tampered = {
      ...envelope,
      payload: { packageId: 'PKG-100', version: '2.0.0-MALICIOUS' },
    };

    const result = await verifyEnvelope(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('DIGEST_MISMATCH');
    }
  });

  it('rejects an envelope if the signature is invalid or forged', async () => {
    const keyPair1 = await generateKeyPair();
    const keyPair2 = await generateKeyPair();

    const envelope = await createEnvelope({
      messageType: 'trace_handover',
      originDeviceId: 'dev_trace_01',
      originPublicKey: keyPair1.publicKey,
      originPrivateKey: keyPair1.privateKey,
      payload: { shipmentId: 'SHIP-55' },
    });

    // Replace originPublicKey with keyPair2 but signature was made by keyPair1
    const forged = {
      ...envelope,
      originPublicKeyJwk: await exportPublicKey(keyPair2.publicKey),
    };

    const result = await verifyEnvelope(forged);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects expired envelopes', async () => {
    const keyPair = await generateKeyPair();
    const envelope = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'dev_test_01',
      originPublicKey: keyPair.publicKey,
      originPrivateKey: keyPair.privateKey,
      payload: { test: true },
      expiresInMs: 100,
    });

    // Verify after expiration
    const result = await verifyEnvelope(envelope, Date.now() + 500);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('EXPIRED');
    }
  });

  it('rejects envelopes exceeding max hops', async () => {
    const keyPair = await generateKeyPair();
    const envelope = await createEnvelope({
      messageType: 'rescue_incident',
      originDeviceId: 'dev_test_01',
      originPublicKey: keyPair.publicKey,
      originPrivateKey: keyPair.privateKey,
      payload: { test: true },
      maxHops: 2,
    });

    envelope.hopCount = 3; // Exceeded
    const result = await verifyEnvelope(envelope);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('HOP_LIMIT_EXCEEDED');
    }
  });
});

describe('Replay Protector & Trust Registry', () => {
  beforeEach(() => {
    getStorage().clear();
  });

  it('detects duplicate message IDs and nonces', () => {
    const rp = new ReplayProtector();
    const res1 = rp.checkAndRecord('msg_101', 'dev_a', 'nonce_x');
    expect(res1.isReplay).toBe(false);

    // Duplicate messageId
    const res2 = rp.checkAndRecord('msg_101', 'dev_a', 'nonce_y');
    expect(res2.isReplay).toBe(true);

    // Duplicate nonce from same sender
    const res3 = rp.checkAndRecord('msg_102', 'dev_a', 'nonce_x');
    expect(res3.isReplay).toBe(true);

    // Same nonce from different sender is permitted
    const res4 = rp.checkAndRecord('msg_103', 'dev_b', 'nonce_x');
    expect(res4.isReplay).toBe(false);
  });

  it('manages trusted devices and updates trust levels', async () => {
    const tr = new TrustRegistry();
    const keyPair = await generateKeyPair();
    const jwk = await exportPublicKey(keyPair.publicKey);

    const enrolled = tr.enroll({
      name: 'Field Radio 1',
      publicKeyJwk: jwk,
      notes: 'Zone Alpha',
    });

    expect(enrolled.name).toBe('Field Radio 1');
    expect(tr.isTrusted(enrolled.id)).toBe(true);

    tr.updateTrust(enrolled.id, 'revoked');
    expect(tr.isTrusted(enrolled.id)).toBe(false);

    tr.remove(enrolled.id);
    expect(tr.get(enrolled.id)).toBeUndefined();
  });
});
