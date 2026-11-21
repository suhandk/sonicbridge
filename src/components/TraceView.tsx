import React, { useState, useEffect } from 'react';
import type { ShipmentRecord, HandoverEvent } from '../types/trace';
import { defaultTraceState } from '../scenarios/trace/state';
import type { AcousticBridge } from '../bridge/acoustic-bridge';

interface TraceViewProps {
  bridge: AcousticBridge;
  onSendPayload: (bytes: Uint8Array, description: string) => Promise<void>;
  currentDeviceId: string;
}

export function TraceView({ bridge, onSendPayload, currentDeviceId }: TraceViewProps) {
  const [shipments, setShipments] = useState<ShipmentRecord[]>(defaultTraceState.getShipments());
  const [handovers, setHandovers] = useState<HandoverEvent[]>(defaultTraceState.getHandovers());
  const [stats, setStats] = useState(defaultTraceState.getStats());
  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(shipments[0]?.shipmentId || '');
  const [isComposing, setIsComposing] = useState(false);
  const [isHandingOver, setIsHandingOver] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Shipment Form state
  const [itemDescription, setItemDescription] = useState('');
  const [quantity, setQuantity] = useState(100);
  const [unit, setUnit] = useState('Boxes');
  const [senderOrg, setSenderOrg] = useState('Regional Medical Logistics');
  const [intendedReceiver, setIntendedReceiver] = useState('Base Camp Hospital Clinic');
  const [origin, setOrigin] = useState('Central Warehouse A');
  const [destination, setDestination] = useState('Hospital Receiving Dock');

  // Handover Form state
  const [handoverTo, setHandoverTo] = useState('LOGISTICS-VAN-08');
  const [handoverLocation, setHandoverLocation] = useState('Checkpoint Delta Station');
  const [handoverNotes, setHandoverNotes] = useState('Temperature logged at 4.0°C; seal intact.');

  useEffect(() => {
    return defaultTraceState.subscribe(() => {
      setShipments(defaultTraceState.getShipments());
      setHandovers(defaultTraceState.getHandovers());
      setStats(defaultTraceState.getStats());
    });
  }, []);

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const shipment: ShipmentRecord = {
        shipmentId: `SHIP-${Date.now().toString(36).toUpperCase()}`,
        packageId: `PKG-${Date.now().toString(36).slice(2, 6).toUpperCase()}`,
        itemDescription,
        quantity: Number(quantity),
        unit,
        senderOrganization: senderOrg,
        intendedReceiver,
        originLocation: origin,
        destinationLocation: destination,
        createdAt: Date.now(),
        expectedDeliveryAt: Date.now() + 1000 * 60 * 60 * 48,
        currentHolderDeviceId: currentDeviceId,
      };

      defaultTraceState.addShipment(shipment);
      setSelectedShipmentId(shipment.shipmentId);
      setIsComposing(false);
      setStatusMessage(`Shipment ${shipment.shipmentId} registered.`);

      // Acoustic transmit
      const { packedBytes } = await bridge.composeAndQueue('trace_handover', shipment);
      await onSendPayload(packedBytes, `Shipment Handover: ${shipment.itemDescription}`);
      setStatusMessage(`Acoustic broadcast initiated for ${shipment.shipmentId}.`);
    } catch (err) {
      setStatusMessage(`Shipment creation failed: ${String(err)}`);
    }
  };

  const handleExecuteHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShipmentId) return;

    try {
      const handover: HandoverEvent = {
        handoverId: `HO-${Date.now().toString(36).toUpperCase()}`,
        shipmentId: selectedShipmentId,
        fromDeviceId: currentDeviceId,
        toDeviceId: handoverTo,
        location: handoverLocation,
        timestamp: Date.now(),
        status: 'ACCEPTED',
        signature: `SIG_HO_${Date.now()}`,
        notes: handoverNotes,
      };

      defaultTraceState.addHandover(handover);
      setIsHandingOver(false);
      setStatusMessage(`Handover ${handover.handoverId} recorded.`);

      // Acoustic transmit handover
      const { packedBytes } = await bridge.composeAndQueue('trace_acceptance', handover);
      await onSendPayload(packedBytes, `Custody Handover: ${handover.handoverId}`);
      setStatusMessage(`Acoustic broadcast initiated for handover ${handover.handoverId}.`);
    } catch (err) {
      setStatusMessage(`Handover error: ${String(err)}`);
    }
  };

  const handleTransmitShipment = async (shipment: ShipmentRecord) => {
    try {
      setStatusMessage(`Packaging and signing custody transfer for ${shipment.shipmentId}...`);
      const { packedBytes } = await bridge.composeAndQueue('trace_handover', shipment);
      await onSendPayload(packedBytes, `Trace: ${shipment.itemDescription}`);
      setStatusMessage(`Acoustic broadcast initiated for ${shipment.shipmentId}.`);
    } catch (err) {
      setStatusMessage(`Transmission error: ${String(err)}`);
    }
  };

  const selectedCustody = selectedShipmentId ? defaultTraceState.getCustodyChain(selectedShipmentId) : undefined;

  return (
    <div className="scenario-view trace-theme">
      {/* Scenario Header */}
      <div className="scenario-header">
        <div>
          <h2>SONICBRIDGE TRACE</h2>
          <p className="scenario-tagline">"Every handover. Verified. Offline."</p>
        </div>
        <div className="scenario-actions">
          <button className="btn-secondary" onClick={() => defaultTraceState.resetDemo()}>
            Load Demo Preset
          </button>
          <button className="btn-primary" onClick={() => setIsComposing(!isComposing)}>
            {isComposing ? 'Cancel Compose' : '+ Register Shipment'}
          </button>
        </div>
      </div>

      {statusMessage && <div className="status-banner info">{statusMessage}</div>}

      {/* Logistics Dashboard Metrics */}
      <div className="dashboard-metrics">
        <div className="metric-card">
          <span className="metric-label">Active Shipments</span>
          <span className="metric-value">{stats.activeShipments}</span>
        </div>
        <div className="metric-card ok">
          <span className="metric-label">Completed Handovers</span>
          <span className="metric-value">{stats.acceptedHandovers}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Total Handover Events</span>
          <span className="metric-value">{stats.totalHandovers}</span>
        </div>
        <div className="metric-card critical">
          <span className="metric-label">Rejected Handovers</span>
          <span className="metric-value">{stats.rejectedHandovers}</span>
        </div>
      </div>

      {/* Compose Shipment Form */}
      {isComposing && (
        <form className="console-form" onSubmit={handleCreateShipment}>
          <h3>Register New Physical Shipment</h3>
          <div className="form-group">
            <label>Item Description</label>
            <input
              type="text"
              placeholder="e.g. Critical Vaccine Vials (Cold Chain 2-8°C)"
              value={itemDescription}
              onChange={e => setItemDescription(e.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Quantity & Unit</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="number"
                  value={quantity}
                  onChange={e => setQuantity(Number(e.target.value))}
                  style={{ width: '100px' }}
                  required
                />
                <input
                  type="text"
                  value={unit}
                  onChange={e => setUnit(e.target.value)}
                  style={{ width: '120px' }}
                  required
                />
              </div>
            </div>
            <div className="form-group">
              <label>Sender Organization</label>
              <input
                type="text"
                value={senderOrg}
                onChange={e => setSenderOrg(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Origin Location</label>
              <input
                type="text"
                value={origin}
                onChange={e => setOrigin(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Destination Location</label>
              <input
                type="text"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setIsComposing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Sign & Broadcast Acoustically
            </button>
          </div>
        </form>
      )}

      {/* Handover Modal Form */}
      {isHandingOver && (
        <form className="console-form" onSubmit={handleExecuteHandover}>
          <h3>Authorize Custody Handover — {selectedShipmentId}</h3>
          <div className="form-row">
            <div className="form-group">
              <label>Transfer Custody To (Device / Agent ID)</label>
              <input
                type="text"
                value={handoverTo}
                onChange={e => setHandoverTo(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Handover Checkpoint Location</label>
              <input
                type="text"
                value={handoverLocation}
                onChange={e => setHandoverLocation(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Inspection & Verification Notes</label>
            <input
              type="text"
              value={handoverNotes}
              onChange={e => setHandoverNotes(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={() => setIsHandingOver(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Sign Handover & Transmit Acoustically
            </button>
          </div>
        </form>
      )}

      {/* Shipments List & Chain-of-Custody Inspector */}
      <div className="trace-split-view">
        <div className="shipments-list-panel">
          <h3>Tracked Shipments</h3>
          {shipments.map(s => (
            <div
              key={s.shipmentId}
              className={`shipment-card ${selectedShipmentId === s.shipmentId ? 'selected' : ''}`}
              onClick={() => setSelectedShipmentId(s.shipmentId)}
            >
              <div className="shipment-card-top">
                <strong>{s.shipmentId}</strong>
                <span className="badge-category">{s.packageId}</span>
              </div>
              <p className="shipment-item-title">{s.itemDescription}</p>
              <div className="shipment-meta">
                <span>Qty: {s.quantity} {s.unit}</span>
                <span>Current Holder: <strong>{s.currentHolderDeviceId}</strong></span>
              </div>
              <div className="shipment-card-bottom">
                <button
                  className="btn-transmit-acoustic"
                  onClick={e => {
                    e.stopPropagation();
                    handleTransmitShipment(s);
                  }}
                >
                  🔊 Transmit Custody
                </button>
                <button
                  className="btn-secondary"
                  onClick={e => {
                    e.stopPropagation();
                    setSelectedShipmentId(s.shipmentId);
                    setIsHandingOver(true);
                  }}
                >
                  🤝 Handover
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Chain-of-Custody Timeline */}
        <div className="custody-timeline-panel">
          <h3>Cryptographic Chain of Custody</h3>
          {selectedCustody ? (
            <div>
              <div className="custody-summary-box">
                <h4>{selectedCustody.shipment.itemDescription}</h4>
                <p>Origin: <strong>{selectedCustody.shipment.originLocation}</strong> → Destination: <strong>{selectedCustody.shipment.destinationLocation}</strong></p>
                <p>Sender Org: {selectedCustody.shipment.senderOrganization}</p>
              </div>

              <div className="timeline-trail">
                <div className="timeline-node genesis">
                  <div className="timeline-dot" />
                  <div className="timeline-content">
                    <span className="timeline-time">{new Date(selectedCustody.shipment.createdAt).toLocaleTimeString()}</span>
                    <strong>Shipment Registered & Sealed</strong>
                    <p>Origin: {selectedCustody.shipment.originLocation}</p>
                    <span className="device-tag">Initial Custodian: {selectedCustody.shipment.currentHolderDeviceId}</span>
                  </div>
                </div>

                {selectedCustody.handovers.map((h, idx) => (
                  <div key={h.handoverId} className="timeline-node">
                    <div className="timeline-dot" />
                    <div className="timeline-content">
                      <div className="timeline-node-header">
                        <span className="timeline-time">{new Date(h.timestamp).toLocaleTimeString()}</span>
                        <span className="badge-ok">VERIFIED HANDOVER #{idx + 1}</span>
                      </div>
                      <strong>{h.fromDeviceId} ➔ {h.toDeviceId}</strong>
                      <p>Location: {h.location}</p>
                      {h.notes && <p className="timeline-notes">"{h.notes}"</p>}
                      <div className="sig-hash-line">
                        <code>{h.signature.slice(0, 24)}...</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-notice">Select a shipment to inspect its verifiable chain of custody.</p>
          )}
        </div>
      </div>
    </div>
  );
}
