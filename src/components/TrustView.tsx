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
        throw new Error('Invalid ECDSA P-256 public key JWK.');
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
      setStatusMessage(`Enrollment error: ${String(err)}`);
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

  const handleRemove = (id: string) => {
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
          <p className="scenario-tagline">"Zero-knowledge acoustic authentication with Web Crypto ECDSA P-256."</p>
        </div>
      </div>

      {statusMessage && <div className="status-banner info">{statusMessage}</div>}

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

          <h4>Public Key Card (Share with Peers)</h4>
          <p className="note-text">Peers can import this public key card to verify your digital acoustic signatures:</p>
          <div className="card-json-box">
            <textarea readOnly rows={5} value={localCardJson} className="code-textarea" />
          </div>
          <button
            className="btn-secondary"
            onClick={() => {
              navigator.clipboard?.writeText(localCardJson);
              setStatusMessage('Public identity card copied to clipboard.');
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
              <label>Peer Device Label / Name</label>
              <input
                type="text"
                placeholder="e.g. Field Coordinator Tablet B"
                value={enrollName}
                onChange={e => setEnrollName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Paste Peer Public Key JSON (or Identity Card)</label>
              <textarea
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
                      <button className="btn-small danger" onClick={() => handleRemove(dev.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
