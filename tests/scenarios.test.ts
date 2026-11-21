import { describe, it, expect, beforeEach } from 'vitest';
import { RescueStateManager } from '../src/scenarios/rescue/state';
import { AirGapStateManager } from '../src/scenarios/airgap/state';
import { TraceStateManager } from '../src/scenarios/trace/state';
import { AcousticBridge } from '../src/bridge/acoustic-bridge';
import { generateKeyPair } from '../src/security/crypto';
import { getStorage } from '../src/security/storage-helper';
import { verifyContent, packContent } from '../src/content';

describe('Rescue Scenario Workflow', () => {
  beforeEach(() => {
    getStorage().clear();
  });

  it('sorts incident reports deterministically by priority (Critical > High > Medium > Low)', () => {
    const rescue = new RescueStateManager();
    const now = Date.now();
    rescue.addReport({
      incidentId: 'INC-LOW-1',
      category: 'logistics',
      priority: 'Low',
      title: 'Road minor debris',
      locationDescription: 'Route 9',
      affectedCount: 0,
      resources: [],
      description: 'Minor gravel',
      reportingDeviceId: 'NODE-1',
      createdAt: now + 500,
      expiresAt: now + 50000,
    });
    rescue.addReport({
      incidentId: 'INC-CRIT-1',
      category: 'medical',
      priority: 'Critical',
      title: 'Triage support needed',
      locationDescription: 'Camp 3',
      affectedCount: 20,
      resources: [{ type: 'First Aid', quantity: 10, unit: 'Kits', urgency: 'Immediate' }],
      description: 'Casualties require trauma care',
      reportingDeviceId: 'NODE-2',
      createdAt: now + 1000,
      expiresAt: now + 60000,
    });

    const list = rescue.getAll();
    expect(list[0].priority).toBe('Critical');
    expect(list[0].incidentId).toBe('INC-CRIT-1');
  });

  it('calculates incident statistics correctly', () => {
    const rescue = new RescueStateManager();
    const stats = rescue.getStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(typeof stats.critical).toBe('number');
  });
});

describe('Air-Gap Scenario Workflow', () => {
  beforeEach(() => {
    getStorage().clear();
  });

  it('registers assets and enforces quarantine workflow for configuration packages', () => {
    const airgap = new AirGapStateManager();
    const packages = airgap.getPackages();
    expect(packages.length).toBeGreaterThan(0);

    const initialQuarantine = packages[0].quarantined;
    expect(initialQuarantine).toBe(true);

    // Operator approves the package
    airgap.approvePackage(packages[0].packageId, 'Senior Engineer Alice');
    const updated = airgap.getPackages().find(p => p.packageId === packages[0].packageId);
    expect(updated?.quarantined).toBe(false);
    expect(updated?.approvedBy).toBe('Senior Engineer Alice');
  });
});

describe('Trace Scenario Workflow', () => {
  beforeEach(() => {
    getStorage().clear();
  });

  it('manages custody handovers and prevents duplicate handover events', () => {
    const trace = new TraceStateManager();
    const shipments = trace.getShipments();
    expect(shipments.length).toBeGreaterThan(0);

    const shipmentId = shipments[0].shipmentId;
    trace.addHandover({
      handoverId: 'HO-UNIQUE-999',
      shipmentId,
      fromDeviceId: 'WH-A',
      toDeviceId: 'TRUCK-B',
      location: 'Checkpoint 1',
      timestamp: Date.now(),
      status: 'ACCEPTED',
      signature: 'SIG_HO_1',
    });

    const chain = trace.getCustodyChain(shipmentId);
    expect(chain?.handovers.some(h => h.handoverId === 'HO-UNIQUE-999')).toBe(true);

    // Duplicate handoverId must throw
    expect(() => {
      trace.addHandover({
        handoverId: 'HO-UNIQUE-999',
        shipmentId,
        fromDeviceId: 'WH-A',
        toDeviceId: 'TRUCK-B',
        location: 'Checkpoint 1',
        timestamp: Date.now(),
        status: 'ACCEPTED',
        signature: 'SIG_HO_DUPLICATE',
      });
    }).toThrow(/Duplicate handover ID/);
  });
});

describe('AcousticBridge Integration', () => {
  beforeEach(() => {
    getStorage().clear();
  });

  it('composes, packs, verifies and decodes acoustic message envelopes', async () => {
    const keyPair = await generateKeyPair();
    const bridge = new AcousticBridge();
    bridge.setLocalIdentity('dev_unit_tester', keyPair.publicKey, keyPair.privateKey);

    const { envelope, packedBytes } = await bridge.composeAndQueue(
      'rescue_incident',
      { incidentId: 'TEST-INC', priority: 'High' }
    );

    expect(envelope.messageId.startsWith('msg_')).toBe(true);
    expect(packedBytes.length).toBeLessThan(4096);

    // Verify content packing via standard SonicBridge verifyContent
    const verified = verifyContent(packedBytes);
    expect(verified.kind).toBe('text');
    expect(verified.text).toBeDefined();

    // Pass through acoustic bridge receiver handler
    const event = await bridge.handleReceivedContent(verified);
    expect(event).not.toBeNull();
    expect(event?.envelope.messageId).toBe(envelope.messageId);
    expect(event?.verification.valid).toBe(true);
    expect(event?.isReplay).toBe(false);
  });
});
