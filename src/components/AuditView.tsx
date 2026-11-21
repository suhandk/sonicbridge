import React, { useState, useEffect } from 'react';
import type { AuditEntry } from '../types/audit';
import { defaultAuditLedger } from '../storage/audit';

export function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [integrityStatus, setIntegrityStatus] = useState<{
    checked: boolean;
    valid?: boolean;
    message?: string;
  }>({ checked: false });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadEntries = async () => {
    const list = await defaultAuditLedger.getEntries();
    setEntries(list);
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const handleVerify = async () => {
    setStatusMessage('Verifying cryptographic SHA-256 hash-chain pointers across all entries...');
    const result = await defaultAuditLedger.verifyIntegrity();
    if (result.valid) {
      setIntegrityStatus({
        checked: true,
        valid: true,
        message: `✓ Hash-chain intact! All ${entries.length} cryptographic audit records verified without modification.`,
      });
      setStatusMessage('Integrity check PASSED.');
    } else {
      setIntegrityStatus({
        checked: true,
        valid: false,
        message: `✕ Tampering detected at index ${result.brokenAtIndex}: ${result.reason}`,
      });
      setStatusMessage('Integrity check FAILED: Tampering detected.');
    }
  };

  const handleExportJson = async () => {
    const json = await defaultAuditLedger.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sonicbridge-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('Audit ledger exported as JSON.');
  };

  const handleExportCsv = async () => {
    const csv = await defaultAuditLedger.exportCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sonicbridge-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('Audit ledger exported as CSV.');
  };

  return (
    <div className="scenario-view">
      <div className="scenario-header">
        <div>
          <h2>CRYPTOGRAPHIC AUDIT LEDGER</h2>
          <p className="scenario-tagline">"Append-only, SHA-256 hash-linked audit history. Complete offline compliance."</p>
        </div>
        <div className="scenario-actions">
          <button className="btn-secondary" onClick={handleExportJson}>
            Export JSON
          </button>
          <button className="btn-secondary" onClick={handleExportCsv}>
            Export CSV
          </button>
          <button className="btn-primary" onClick={handleVerify}>
            🛡️ Verify Chain Integrity
          </button>
        </div>
      </div>

      <div className={statusMessage ? "status-banner info" : undefined} role="status">{statusMessage}</div>

      {integrityStatus.checked && (
        <div className={`status-banner ${integrityStatus.valid ? 'ok' : 'critical'}`}>
          {integrityStatus.message}
        </div>
      )}

      <div className="table-section">
        <h3>Hash-Linked Audit Records ({entries.length})</h3>
        {entries.length === 0 ? (
          <p className="empty-notice">No audit records logged yet.</p>
        ) : (
          <div className="table-content">
            <p className="table-scroll-hint">Scroll sideways to see more columns.</p>
            <div className="table-scroll" role="region" aria-label="Audit records" data-lenis-prevent tabIndex={0}>
              <table className="console-table audit-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Event Type</th>
                    <th>Device ID</th>
                    <th>Details</th>
                    <th>Hash Pointer</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.index}>
                      <td><strong>{e.index}</strong></td>
                      <td>{new Date(e.timestamp).toLocaleTimeString()}</td>
                      <td><span className="badge-category">{e.eventType}</span></td>
                      <td><code>{e.deviceId}</code></td>
                      <td>
                        <pre className="inline-json">{JSON.stringify(e.details)}</pre>
                      </td>
                      <td>
                        <div className="hash-pointer-cell">
                          <span>Prev: <code>{e.prevHash}</code></span>
                          <span>This: <code>{e.hash}</code></span>
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
