import React, { useState, useEffect } from 'react';
import type { AssetRecord, ConfigPackage } from '../types/airgap';
import { defaultAirGapState } from '../scenarios/airgap/state';
import { calculateDigest } from '../security/crypto';
import type { AcousticBridge } from '../bridge/acoustic-bridge';

interface AirGapViewProps {
  bridge: AcousticBridge;
  onSendPayload: (bytes: Uint8Array, description: string) => Promise<void>;
  currentDeviceId: string;
}

export function AirGapView({ bridge, onSendPayload, currentDeviceId }: AirGapViewProps) {
  const [assets, setAssets] = useState<AssetRecord[]>(defaultAirGapState.getAssets());
  const [packages, setPackages] = useState<ConfigPackage[]>(defaultAirGapState.getPackages());
  const [stats, setStats] = useState(defaultAirGapState.getStats());
  const [isComposing, setIsComposing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Form state
  const [selectedAsset, setSelectedAsset] = useState<string>(assets[0]?.assetId || 'MACHINE-001');
  const [packageName, setPackageName] = useState('');
  const [version, setVersion] = useState('v2.5.0');
  const [description, setDescription] = useState('');
  const [configData, setConfigData] = useState('{\n  "sampling_rate_hz": 1000,\n  "temp_limit_celsius": 85.5,\n  "enable_safety_cutoff": true\n}');

  useEffect(() => {
    return defaultAirGapState.subscribe(() => {
      setAssets(defaultAirGapState.getAssets());
      setPackages(defaultAirGapState.getPackages());
      setStats(defaultAirGapState.getStats());
    });
  }, []);

  const handleCompose = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const digest = calculateDigest(configData);
      const pkg: ConfigPackage = {
        packageId: `PKG-${Date.now().toString(36).toUpperCase()}`,
        targetAssetId: selectedAsset,
        packageName,
        version,
        description,
        configData,
        contentDigestSha256: digest,
        authorDeviceId: currentDeviceId,
        authorOperator: 'Certified Plant Tech #81',
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7,
        quarantined: true,
      };

      defaultAirGapState.addPackage(pkg);
      setIsComposing(false);
      setStatusMessage(`Package ${pkg.packageId} created in quarantine.`);

      // Acoustic transmit
      const { packedBytes } = await bridge.composeAndQueue('airgap_package', pkg);
      await onSendPayload(packedBytes, `Config Package: ${pkg.packageName}`);
      setStatusMessage(`Acoustic broadcast initiated for package ${pkg.packageId}.`);
    } catch (err) {
      setStatusMessage(`Failed to create package: ${String(err)}`);
    }
  };

  const handleTransmit = async (pkg: ConfigPackage) => {
    try {
      setStatusMessage(`Packaging and signing ${pkg.packageId}...`);
      const { packedBytes } = await bridge.composeAndQueue('airgap_package', pkg);
      await onSendPayload(packedBytes, `Config: ${pkg.packageName}`);
      setStatusMessage(`Acoustic broadcast initiated for ${pkg.packageId}.`);
    } catch (err) {
      setStatusMessage(`Transmission error: ${String(err)}`);
    }
  };

  const handleTamperTest = async (pkg: ConfigPackage) => {
    try {
      setStatusMessage(`🚨 DEMO: Intentionally tampering with package ${pkg.packageId}...`);
      // Inject a malicious modification into the configData without updating the signature
      const tamperedPkg = {
        ...pkg,
        configData: pkg.configData.replace(/"temp_limit_celsius":\s*[\d.]+/g, '"temp_limit_celsius": 999.9 /* TAMPERED */'),
      };
      // Send envelope with tampered payload
      const { envelope } = await bridge.composeAndQueue('airgap_package', pkg);
      // Maliciously swap payload after signature
      const tamperedEnvelope = {
        ...envelope,
        payload: tamperedPkg,
      };
      const packedBytes = bridge.packEnvelope(tamperedEnvelope);
      await onSendPayload(packedBytes, `[TAMPERED DEMO] ${pkg.packageName}`);
      setStatusMessage(`🚨 Tampered package sent over acoustic channel. The receiver will cryptographically REJECT it.`);
    } catch (err) {
      setStatusMessage(`Tamper test error: ${String(err)}`);
    }
  };

  const handleApprove = (pkgId: string) => {
    defaultAirGapState.approvePackage(pkgId, 'Chief Reliability Officer');
    setStatusMessage(`Package ${pkgId} APPROVED. Asset configuration version updated.`);
  };

  const handleReject = (pkgId: string) => {
    defaultAirGapState.rejectPackage(pkgId, 'Rejected during physical operator inspection.');
    setStatusMessage(`Package ${pkgId} REJECTED.`);
  };

  return (
    <div className="scenario-view airgap-theme">
      {/* Scenario Header */}
      <div className="scenario-header">
        <div>
          <h2>SONICBRIDGE AIR-GAP</h2>
          <p className="scenario-tagline">"Secure data exchange without network connectivity."</p>
        </div>
        <div className="scenario-actions">
          <button className="btn-secondary" onClick={() => {
            if (window.confirm('Replace locally saved configuration packages with sample data?')) {
              defaultAirGapState.resetDemo();
              setStatusMessage('Sample data restored.');
            }
          }}>
            Load Demo Preset
          </button>
          <button className="btn-primary" aria-expanded={isComposing} onClick={() => setIsComposing(!isComposing)}>
            {isComposing ? 'Cancel Compose' : '+ Create Config Package'}
          </button>
        </div>
      </div>

      <div className={statusMessage ? "status-banner info" : undefined} role="status">{statusMessage}</div>

      {/* Security Dashboard */}
      <div className="dashboard-metrics">
        <div className="metric-card">
          <span className="metric-label">Registered Assets</span>
          <span className="metric-value">{stats.totalAssets}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Config Packages</span>
          <span className="metric-value">{stats.totalPackages}</span>
        </div>
        <div className="metric-card high">
          <span className="metric-label">In Quarantine</span>
          <span className="metric-value">{stats.quarantined}</span>
        </div>
        <div className="metric-card ok">
          <span className="metric-label">Approved & Active</span>
          <span className="metric-value">{stats.approved}</span>
        </div>
        <div className="metric-card critical">
          <span className="metric-label">Rejected Packages</span>
          <span className="metric-value">{stats.rejected}</span>
        </div>
      </div>

      {/* Compose Config Form */}
      {isComposing && (
        <form className="console-form" onSubmit={handleCompose}>
          <h3>Create Signed Configuration Package</h3>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="config-asset">Target Industrial Asset</label>
              <select id="config-asset" value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}>
                {assets.map(a => (
                  <option key={a.assetId} value={a.assetId}>
                    {a.assetId} - {a.machineName} ({a.currentConfigVersion})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="config-version">New Config Version</label>
              <input id="config-version"
                type="text"
                value={version}
                onChange={e => setVersion(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="config-title">Package Title</label>
            <input id="config-title"
              type="text"
              placeholder="e.g. Turbine Harmonic Damper Calibration"
              value={packageName}
              onChange={e => setPackageName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="config-description">Package Description & Justification</label>
            <input id="config-description"
              type="text"
              placeholder="Engineering justification for parameter changes..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="config-payload">Configuration Payload (JSON / Parameter Map)</label>
            <textarea id="config-payload"
              rows={4}
              value={configData}
              onChange={e => setConfigData(e.target.value)}
              className="code-textarea"
              required
            />
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

      {/* Asset Inventory Table */}
      <div className="table-section">
        <h3>Registered Critical Industrial Assets</h3>
        <div className="table-content">
          <p className="table-scroll-hint">Scroll sideways to see more columns.</p>
          <div className="table-scroll" role="region" aria-label="Registered industrial assets" data-lenis-prevent tabIndex={0}>
            <table className="console-table">
              <thead>
                <tr>
                  <th>Asset ID</th>
                  <th>Machine Name</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Active Version</th>
                  <th>Authorized Operator</th>
                </tr>
              </thead>
              <tbody>
                {assets.map(a => (
                  <tr key={a.assetId}>
                    <td><strong>{a.assetId}</strong></td>
                    <td>{a.machineName}</td>
                    <td><span className="badge-category">{a.category}</span></td>
                    <td>{a.location}</td>
                    <td><span className="version-pill">{a.currentConfigVersion}</span></td>
                    <td>{a.authorizedOperator}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Quarantine & Configuration Packages List */}
      <div className="reports-section">
        <h3>Configuration Packages & Quarantine Ledger</h3>
        <div className="report-cards-grid">
          {packages.map(pkg => (
            <div
              key={pkg.packageId}
              className={`report-card ${pkg.quarantined ? 'quarantine-card' : 'approved-card'}`}
            >
              <div className="report-card-header">
                <span className={`badge-priority ${pkg.quarantined ? 'high' : 'ok'}`}>
                  {pkg.quarantined ? (pkg.rejectedReason ? 'REJECTED' : 'QUARANTINE') : 'APPROVED'}
                </span>
                <span className="version-pill">{pkg.version}</span>
                <span className="target-asset">Target: {pkg.targetAssetId}</span>
              </div>

              <h4 className="report-title">{pkg.packageName}</h4>
              <p className="report-desc">{pkg.description}</p>

              <div className="digest-box">
                <span className="digest-label">SHA-256 Digest:</span>
                <code>{pkg.contentDigestSha256}</code>
              </div>

              <div className="config-preview">
                <pre>{pkg.configData}</pre>
              </div>

              <div className="package-footer-details">
                <span>Author: {pkg.authorOperator} ({pkg.authorDeviceId})</span>
                {pkg.approvedBy && <span className="ok-text">Approved by {pkg.approvedBy}</span>}
                {pkg.rejectedReason && <span className="err-text">Reason: {pkg.rejectedReason}</span>}
              </div>

              <div className="report-card-footer">
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {pkg.quarantined && !pkg.rejectedReason && (
                    <>
                      <button className="btn-approve" onClick={() => handleApprove(pkg.packageId)}>
                        ✓ Approve & Apply
                      </button>
                      <button className="btn-reject" onClick={() => handleReject(pkg.packageId)}>
                        ✕ Reject
                      </button>
                    </>
                  )}
                  <button className="btn-transmit-acoustic" onClick={() => handleTransmit(pkg)}>
                    🔊 Send via Sound
                  </button>
                  <button className="btn-tamper" onClick={() => handleTamperTest(pkg)}>
                    ⚠️ Test Tamper Rejection
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
