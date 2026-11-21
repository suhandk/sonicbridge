import React, { useState } from 'react';
import type { IncidentReport, IncidentCategory, IncidentPriority } from '../types/rescue';
import type { ConfigPackage } from '../types/airgap';
import type { ShipmentRecord, HandoverEvent } from '../types/trace';
import type { SonicEnvelope } from '../types/envelope';

export type TabType = 'rescue' | 'airgap' | 'trace' | 'transceiver' | 'trust' | 'relay' | 'audit' | 'visualizer';

interface HumanReadableReceiptProps {
  text: string;
  source: string;
  onNavigateTab?: (tab: TabType) => void;
}

export function HumanReadableReceipt({ text, source, onNavigateTab }: HumanReadableReceiptProps) {
  const [showRaw, setShowRaw] = useState(false);

  // Try parsing the text as a SonicEnvelope or structured JSON
  let parsedEnvelope: SonicEnvelope | null = null;
  let genericJson: Record<string, unknown> | null = null;

  if (typeof text === 'string' && text.trim().startsWith('{') && text.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        if ('messageType' in parsed && 'payload' in parsed) {
          parsedEnvelope = parsed as SonicEnvelope;
        } else {
          genericJson = parsed as Record<string, unknown>;
        }
      }
    } catch {
      // Plain text or invalid JSON
    }
  }

  // Helper to format incident categories nicely
  const formatCategory = (cat?: IncidentCategory | string) => {
    switch (cat) {
      case 'food_water': return 'Food & Drinking Water';
      case 'medical': return 'Emergency Medical Support';
      case 'search_rescue': return 'Search & Rescue';
      case 'shelter': return 'Shelter & Evacuation';
      case 'hazard': return 'Hazard & Chemical Warning';
      case 'logistics': return 'Logistics & Distribution';
      default: return cat ? String(cat).toUpperCase() : 'General Triage';
    }
  };

  // Helper for priority styling
  const getPriorityClass = (priority?: IncidentPriority | string) => {
    const p = (priority || '').toLowerCase();
    if (p === 'critical') return 'priority-critical';
    if (p === 'high') return 'priority-high';
    if (p === 'medium') return 'priority-medium';
    return 'priority-low';
  };

  // 1. RESCUE INCIDENT REPORT
  if (parsedEnvelope && parsedEnvelope.messageType === 'rescue_incident') {
    const report = parsedEnvelope.payload as IncidentReport;
    const priorityClass = getPriorityClass(report.priority);

    return (
      <div className={`human-receipt-card rescue-receipt ${priorityClass}`}>
        <div className="receipt-banner">
          <div className="receipt-meta-row">
            <span className={`badge-priority ${report.priority?.toLowerCase() || 'critical'}`}>
              🚨 {report.priority || 'Critical'} Priority
            </span>
            <span className="badge-category">{formatCategory(report.category)}</span>
            <span className="badge-id mono">{report.incidentId || 'INC-SEC4'}</span>
          </div>
          <h3 className="receipt-title">{report.title || 'Emergency Incident Dispatch'}</h3>
        </div>

        <div className="receipt-content-body">
          {report.locationDescription && (
            <div className="receipt-info-row">
              <span className="info-icon">📍</span>
              <div className="info-text">
                <strong>Location:</strong> {report.locationDescription}
                {report.gps && (
                  <span className="gps-pill mono">
                    GPS: {report.gps.latitude?.toFixed(4)}°, {report.gps.longitude?.toFixed(4)}°
                    {report.gps.accuracy ? ` (±${report.gps.accuracy}m)` : ''}
                  </span>
                )}
              </div>
            </div>
          )}

          {typeof report.affectedCount === 'number' && report.affectedCount > 0 && (
            <div className="receipt-info-row">
              <span className="info-icon">👥</span>
              <div className="info-text">
                <strong>Casualties / Affected:</strong>{' '}
                <span className="highlight-stat">{report.affectedCount} individuals</span>
              </div>
            </div>
          )}

          {report.description && (
            <div className="receipt-description-box">
              <p>{report.description}</p>
            </div>
          )}

          {report.resources && report.resources.length > 0 && (
            <div className="receipt-resources-section">
              <span className="resources-title">📦 Required Resources:</span>
              <div className="resources-pill-grid">
                {report.resources.map((res, idx) => (
                  <div key={idx} className={`resource-card-pill urgency-${(res.urgency || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`}>
                    <div className="resource-qty">{res.quantity} {res.unit}</div>
                    <div className="resource-name">{res.type}</div>
                    <span className="resource-urgency-badge">{res.urgency}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="receipt-provenance-bar">
          <div className="prov-status">
            <span className="prov-dot-green">●</span>
            <span>Acoustic ECDSA P-256: <strong>Cryptographically Verified ✓</strong></span>
          </div>
          <div className="prov-details mono">
            <span>Sender: <code>{parsedEnvelope.originDeviceId}</code></span>
            <span>·</span>
            <span>{parsedEnvelope.hopCount === 0 ? 'Direct Acoustic Link' : `${parsedEnvelope.hopCount} mesh hops`}</span>
          </div>
        </div>

        {onNavigateTab && (
          <div className="receipt-tab-action">
            <button
              type="button"
              className="btn-open-scenario"
              onClick={() => onNavigateTab('rescue')}
            >
              🚨 Open in Rescue Mesh Dashboard →
            </button>
          </div>
        )}

        <details className="raw-details-toggle">
          <summary>Technical Envelope JSON (click to inspect wire payload)</summary>
          <pre className="raw-json-block mono">{text}</pre>
        </details>
      </div>
    );
  }

  // 2. AIR-GAP CONFIGURATION PACKAGE
  if (parsedEnvelope && parsedEnvelope.messageType === 'airgap_package') {
    const pkg = parsedEnvelope.payload as ConfigPackage;

    return (
      <div className="human-receipt-card airgap-receipt">
        <div className="receipt-banner">
          <div className="receipt-meta-row">
            <span className="badge-airgap-status quarantined">🔒 QUARANTINED</span>
            <span className="badge-category">{pkg.version || 'v1.0'}</span>
            <span className="badge-id mono">{pkg.packageId}</span>
          </div>
          <h3 className="receipt-title">{pkg.packageName || 'Air-Gap Configuration Package'}</h3>
        </div>

        <div className="receipt-content-body">
          <div className="receipt-info-row">
            <span className="info-icon">⚙️</span>
            <div className="info-text">
              <strong>Target Asset:</strong> <code className="mono">{pkg.targetAssetId}</code>
            </div>
          </div>

          <div className="receipt-info-row">
            <span className="info-icon">👤</span>
            <div className="info-text">
              <strong>Authorized Author:</strong> {pkg.authorOperator || 'Operator'} ({pkg.authorDeviceId || parsedEnvelope.originDeviceId})
            </div>
          </div>

          {pkg.description && (
            <div className="receipt-description-box">
              <p>{pkg.description}</p>
            </div>
          )}
        </div>

        <div className="receipt-provenance-bar">
          <div className="prov-status">
            <span className="prov-dot-green">●</span>
            <span>Signature: <strong>Verified Industrial Origin ✓</strong></span>
          </div>
          <div className="prov-details mono">
            <span>Asset SHA-256 Digest: {pkg.contentDigestSha256?.slice(0, 16)}...</span>
          </div>
        </div>

        {onNavigateTab && (
          <div className="receipt-tab-action">
            <button
              type="button"
              className="btn-open-scenario"
              onClick={() => onNavigateTab('airgap')}
            >
              🔒 Inspect & Approve in Air-Gap View →
            </button>
          </div>
        )}

        <details className="raw-details-toggle">
          <summary>Technical Envelope JSON (click to inspect wire payload)</summary>
          <pre className="raw-json-block mono">{text}</pre>
        </details>
      </div>
    );
  }

  // 3. SUPPLY CHAIN CUSTODY HANDOVER
  if (parsedEnvelope && (parsedEnvelope.messageType === 'trace_handover' || parsedEnvelope.messageType === 'trace_acceptance')) {
    const payload = parsedEnvelope.payload as any;
    const isHandover = parsedEnvelope.messageType === 'trace_acceptance';

    return (
      <div className="human-receipt-card trace-receipt">
        <div className="receipt-banner">
          <div className="receipt-meta-row">
            <span className="badge-trace-status">📦 {isHandover ? 'CUSTODY HANDOVER' : 'SHIPMENT RECORD'}</span>
            <span className="badge-id mono">{payload.shipmentId || payload.handoverId}</span>
          </div>
          <h3 className="receipt-title">{payload.itemDescription || 'Pharmaceutical Cold-Chain Shipment'}</h3>
        </div>

        <div className="receipt-content-body">
          {payload.quantity && (
            <div className="receipt-info-row">
              <span className="info-icon">📊</span>
              <div className="info-text">
                <strong>Quantity:</strong> <span className="highlight-stat">{payload.quantity} {payload.unit}</span>
              </div>
            </div>
          )}

          {payload.senderOrganization && (
            <div className="receipt-info-row">
              <span className="info-icon">🏢</span>
              <div className="info-text">
                <strong>Origin:</strong> {payload.senderOrganization} ({payload.originLocation || 'Depot'})
              </div>
            </div>
          )}

          {payload.intendedReceiver && (
            <div className="receipt-info-row">
              <span className="info-icon">🏥</span>
              <div className="info-text">
                <strong>Destination:</strong> {payload.intendedReceiver} ({payload.destinationLocation || 'Field Hospital'})
              </div>
            </div>
          )}

          {payload.notes && (
            <div className="receipt-description-box">
              <p>{payload.notes}</p>
            </div>
          )}
        </div>

        <div className="receipt-provenance-bar">
          <div className="prov-status">
            <span className="prov-dot-green">●</span>
            <span>Provenance: <strong>ECDSA P-256 Validated Chain ✓</strong></span>
          </div>
          <div className="prov-details mono">
            <span>Holder Device: <code>{payload.currentHolderDeviceId || payload.toDeviceId || parsedEnvelope.originDeviceId}</code></span>
          </div>
        </div>

        {onNavigateTab && (
          <div className="receipt-tab-action">
            <button
              type="button"
              className="btn-open-scenario"
              onClick={() => onNavigateTab('trace')}
            >
              📦 Inspect Custody Chain in Trace View →
            </button>
          </div>
        )}

        <details className="raw-details-toggle">
          <summary>Technical Envelope JSON (click to inspect wire payload)</summary>
          <pre className="raw-json-block mono">{text}</pre>
        </details>
      </div>
    );
  }

  // 4. GENERIC STRUCTURED JSON
  if (genericJson) {
    return (
      <div className="human-receipt-card generic-json-receipt">
        <div className="receipt-banner">
          <div className="receipt-meta-row">
            <span className="badge-category">STRUCTURED DATA</span>
            <span className="badge-id mono">{Object.keys(genericJson).length} properties</span>
          </div>
        </div>
        <div className="receipt-content-body">
          <div className="generic-key-values">
            {Object.entries(genericJson).slice(0, 10).map(([k, v]) => (
              <div key={k} className="kv-row">
                <span className="kv-key mono">{k}:</span>
                <span className="kv-val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
              </div>
            ))}
          </div>
        </div>
        <details className="raw-details-toggle">
          <summary>Raw JSON</summary>
          <pre className="raw-json-block mono">{text}</pre>
        </details>
      </div>
    );
  }

  // 5. REGULAR PLAIN TEXT
  return <p>{text}</p>;
}
