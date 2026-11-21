import React, { useState, useEffect } from 'react';
import type { StoredMessage } from '../storage/db';
import { defaultRelayEngine } from '../relay/relay-engine';
import type { AcousticBridge } from '../bridge/acoustic-bridge';

interface RelayQueueViewProps {
  bridge: AcousticBridge;
  onSendPayload: (bytes: Uint8Array, description: string) => Promise<void>;
  currentDeviceId: string;
}

export function RelayQueueView({ bridge, onSendPayload, currentDeviceId }: RelayQueueViewProps) {
  const [pendingRelays, setPendingRelays] = useState<StoredMessage[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadRelays = async () => {
    const list = await defaultRelayEngine.getPendingRelays();
    setPendingRelays(list);
  };

  useEffect(() => {
    loadRelays();
  }, []);

  const handleForward = async (stored: StoredMessage) => {
    try {
      setStatusMessage(`Forwarding message ${stored.envelope.messageId} to next acoustic hop...`);
      // Prepare forwarded envelope (increments hop count, appends signed hop)
      // Note: In browser context, private key is held in bridge
      // For demo, we can serialize the envelope
      const forwarded = {
        ...stored.envelope,
        hopCount: stored.envelope.hopCount + 1,
        relayHistory: [
          ...stored.envelope.relayHistory,
          {
            deviceId: currentDeviceId,
            timestamp: Date.now(),
            signature: `SIG_RELAY_HOP_${Date.now()}`,
          },
        ],
      };

      const packedBytes = bridge.packEnvelope(forwarded);
      await onSendPayload(packedBytes, `Relay [Hop ${forwarded.hopCount}]: ${stored.envelope.messageId}`);
      await defaultRelayEngine.markRelayed(stored.envelope.messageId);
      await loadRelays();
      setStatusMessage(`Message ${stored.envelope.messageId} forwarded acoustically.`);
    } catch (err) {
      setStatusMessage(`Relay transmission failed: ${String(err)}`);
    }
  };

  return (
    <div className="scenario-view">
      <div className="scenario-header">
        <div>
          <h2>MULTI-HOP STORE-AND-FORWARD ACOUSTIC RELAY</h2>
          <p className="scenario-tagline">"Autonomous mesh relaying over sound with hop limits and loop prevention."</p>
        </div>
      </div>

      {statusMessage && <div className="status-banner info">{statusMessage}</div>}

      <div className="table-section">
        <h3>Pending Outgoing Relay Queue ({pendingRelays.length})</h3>
        {pendingRelays.length === 0 ? (
          <p className="empty-notice">No messages pending relay. Received messages requiring multi-hop routing will appear here automatically.</p>
        ) : (
          <div className="report-cards-grid">
            {pendingRelays.map(r => (
              <div key={r.envelope.messageId} className="report-card">
                <div className="report-card-header">
                  <span className="badge-category">{r.envelope.messageType}</span>
                  <span className="version-pill">Hop {r.envelope.hopCount} / {r.envelope.maxHops}</span>
                  <span className="report-time">{new Date(r.envelope.createdAt).toLocaleTimeString()}</span>
                </div>
                <h4 className="report-title">{r.envelope.messageId}</h4>
                <p>Origin: <strong>{r.envelope.originDeviceId}</strong></p>
                <div className="digest-box">
                  <code>{r.envelope.payloadDigestSha256.slice(0, 24)}...</code>
                </div>
                <div className="report-card-footer">
                  <button className="btn-primary" onClick={() => handleForward(r)}>
                    🔊 Relay to Next Hop (Sound)
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
