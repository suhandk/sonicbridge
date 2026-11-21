import React, { useState } from 'react';
import type { DeviceIdentity, TrustedDevice } from '../types/identity';
import { defaultTrustRegistry } from '../security/trust';
import { deriveFingerprint } from '../security/crypto';

interface TrustViewProps {
  localIdentity: DeviceIdentity;
}

export function TrustView({ localIdentity }: TrustViewProps) {
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>(defaultTrustRegistry.getAll());
  const [enrollName, setEnrollName] = useState('');
  const [enrollJwkJson, setEnrollJwkJson] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleEnrollManual = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(enrollJwkJson);
      const jwk = parsed.publicKeyJwk || parsed;
      if (!jwk.x || !jwk.y || jwk.kty !== 'EC') {
        throw new Error('Expected an ECDSA P-256 public key.');
      }
      const enrolled = defaultTrustRegistry.enroll({
        name: enrollName || `Peer-${deriveFingerprint(jwk).slice(0, 6)}`,
        publicKeyJwk: jwk,
        trustLevel: 'verified',
      });
      setTrustedDevices(defaultTrustRegistry.getAll());
      setEnrollName('');
      setEnrollJwkJson('');
      setStatusMessage(`Enrolled ${enrolled.name} (${enrolled.fingerprint}) as VERIFIED.`);
    } catch (err) {
      setStatusMessage(`Could not enroll this peer. Paste the complete public identity card or ECDSA P-256 public key JSON and try again. ${err instanceof Error ? err.message : ''}`);
    }
  };

  const handleRevoke = (id: string) => {
    defaultTrustRegistry.updateTrust(id, 'revoked');
    setTrustedDevices(defaultTrustRegistry.getAll());
    setStatusMessage(`Device ${id} revoked.`);
  };

  const handleVerify = (id: string) => {
    defaultTrustRegistry.updateTrust(id, 'verified');
    setTrustedDevices(defaultTrustRegistry.getAll());
    setStatusMessage(`Device ${id} verified.`);
  };

  const handleRemove = (id: string, name: string) => {
    if (!window.confirm(`Delete ${name} from this device's trust registry?`)) return;
    defaultTrustRegistry.remove(id);
    setTrustedDevices(defaultTrustRegistry.getAll());
    setStatusMessage(`Device ${id} removed from registry.`);
  };

  const localCardJson = JSON.stringify({
    id: localIdentity.id,
    name: localIdentity.name,
    fingerprint: localIdentity.fingerprint,
    publicKeyJwk: localIdentity.publicKeyJwk,
  }, null, 2);

  return (
    <div className="scenario-view">
      <div className="scenario-header">
        <div>
          <h2>CRYPTOGRAPHIC DEVICE IDENTITY & TRUST REGISTRY</h2>
          <p className="scenario-tagline">Exchange public keys to verify signatures on acoustic messages.</p>
        </div>
      </div>

      <div className={statusMessage ? "status-banner info" : undefined} role="status">{statusMessage}</div>

      <div className="identity-split-view">
        {/* Local Device Identity */}
        <div className="identity-card-panel">
          <h3>This Device's Identity</h3>
          <div className="device-id-box">
            <div className="device-id-row">
              <span>Device Name:</span>
              <strong>{localIdentity.name}</strong>
            </div>
            <div className="device-id-row">
              <span>Fingerprint:</span>
              <code className="fingerprint-badge">{localIdentity.fingerprint}</code>
            </div>
            <div className="device-id-row">
              <span>Key Algorithm:</span>
              <span>ECDSA P-256 (SHA-256)</span>
            </div>
            <div className="device-id-row">
              <span>Created At:</span>
              <span>{new Date(localIdentity.createdAt).toLocaleString()}</span>
            </div>
          </div>

          <h4 id="public-key-card">Public Key Card (Share with Peers)</h4>
          <p className="note-text">Peers can import this public key card to verify your digital acoustic signatures:</p>
          <div className="card-json-box">
            <textarea aria-labelledby="public-key-card" readOnly rows={5} value={localCardJson} className="code-textarea" />
          </div>
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(localCardJson);
                setStatusMessage('Public identity card copied to clipboard.');
              } catch {
                setStatusMessage('Could not copy to the clipboard. Select and copy the public key card above.');
              }
            }}
          >
            📋 Copy Public Identity Card
          </button>
        </div>

        {/* Enroll Peer Form */}
        <div className="enroll-peer-panel">
          <h3>Enroll Trusted Peer Device</h3>
          <form className="console-form" onSubmit={handleEnrollManual}>
            <div className="form-group">
              <label htmlFor="peer-name">Peer Device Label / Name</label>
              <input id="peer-name"
                type="text"
                placeholder="e.g. Field Coordinator Tablet B"
                value={enrollName}
                onChange={e => setEnrollName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="peer-key">Paste Peer Public Key JSON (or Identity Card)</label>
              <textarea id="peer-key"
                rows={5}
                placeholder='{"publicKeyJwk": {"kty": "EC", "crv": "P-256", "x": "...", "y": "..."}}'
                value={enrollJwkJson}
                onChange={e => setEnrollJwkJson(e.target.value)}
                className="code-textarea"
                required
              />
            </div>
            <button type="submit" className="btn-primary">
              ✓ Enroll Peer as Trusted
            </button>
          </form>
        </div>
      </div>

      {/* Enrolled Devices Table */}
      <div className="table-section">
        <h3>Enrolled Trusted Devices ({trustedDevices.length})</h3>
        {trustedDevices.length === 0 ? (
          <p className="empty-notice">No external peer devices enrolled yet. Enroll peers above to verify incoming acoustic signatures.</p>
        ) : (
          <div className="table-content">
            <p className="table-scroll-hint">Scroll sideways to see more columns.</p>
            <div className="table-scroll" role="region" aria-label="Enrolled devices" data-lenis-prevent tabIndex={0}>
              <table className="console-table">
                <thead>
                  <tr>
                    <th>Device Name</th>
                    <th>Fingerprint</th>
                    <th>Trust Level</th>
                    <th>Enrolled At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trustedDevices.map(dev => (
                    <tr key={dev.id}>
                      <td><strong>{dev.name}</strong></td>
                      <td><code>{dev.fingerprint}</code></td>
                      <td>
                        <span className={`badge-trust ${dev.trustLevel}`}>
                          {dev.trustLevel.toUpperCase()}
                        </span>
                      </td>
                      <td>{new Date(dev.enrolledAt).toLocaleDateString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {dev.trustLevel !== 'verified' ? (
                            <button className="btn-small ok" onClick={() => handleVerify(dev.id)}>Verify</button>
                          ) : (
                            <button className="btn-small warn" onClick={() => handleRevoke(dev.id)}>Revoke</button>
                          )}
                          <button className="btn-small danger" onClick={() => handleRemove(dev.id, dev.name)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
