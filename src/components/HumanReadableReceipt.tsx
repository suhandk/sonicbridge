import type { IncidentReport, IncidentCategory, IncidentPriority } from '../types/rescue';
import type { ConfigPackage } from '../types/airgap';
import type { ShipmentRecord, HandoverEvent } from '../types/trace';
import type { SonicEnvelope } from '../types/envelope';

interface HumanReadableReceiptProps {
  text: string;
  onOpenRescue?: () => void;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, kind: 'string' | 'number', names: readonly string[]) {
  return names.every(name => value[name] === undefined || typeof value[name] === kind);
}

function hasRenderablePayload(envelope: Record<string, unknown>) {
  const { messageType, payload } = envelope;
  if (!record(payload) || !fields(envelope, 'string', ['originDeviceId']) || !fields(envelope, 'number', ['hopCount'])) return false;

  switch (messageType) {
    case 'rescue_incident': {
      const { gps, resources } = payload;
      return fields(payload, 'string', ['priority', 'category', 'incidentId', 'title', 'locationDescription', 'description']) &&
        fields(payload, 'number', ['affectedCount']) &&
        (gps === undefined || (record(gps) && fields(gps, 'number', ['latitude', 'longitude', 'accuracy']))) &&
        (resources === undefined || (Array.isArray(resources) && resources.every(item => record(item) &&
          fields(item, 'string', ['urgency', 'type', 'unit']) && fields(item, 'number', ['quantity']))));
    }
    case 'airgap_package':
      return fields(payload, 'string', ['version', 'packageId', 'packageName', 'targetAssetId', 'authorOperator',
        'authorDeviceId', 'description', 'contentDigestSha256']);
    case 'trace_handover':
    case 'trace_acceptance':
      return fields(payload, 'number', ['quantity']) && fields(payload, 'string', ['shipmentId', 'handoverId',
        'itemDescription', 'unit', 'senderOrganization', 'originLocation', 'intendedReceiver', 'destinationLocation',
        'notes', 'currentHolderDeviceId', 'toDeviceId']);
    default:
      return false;
  }
}

export function HumanReadableReceipt({ text, onOpenRescue }: HumanReadableReceiptProps) {

  // Try parsing the text as a SonicEnvelope or structured JSON
  let parsedEnvelope: SonicEnvelope | null = null;
  let genericJson: Record<string, unknown> | null = null;

  if (typeof text === 'string' && text.trim().startsWith('{') && text.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (record(parsed)) {
        if (hasRenderablePayload(parsed)) {
          parsedEnvelope = parsed as unknown as SonicEnvelope;
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
            <span aria-hidden="true">●</span>
            <span><strong>Sender details from received text</strong></span>
          </div>
          <div className="prov-details mono">
            <span>Sender: <code>{parsedEnvelope.originDeviceId}</code></span>
            <span>·</span>
            <span>{typeof parsedEnvelope.hopCount === 'number' ? `${parsedEnvelope.hopCount} reported hops` : 'Hop count unavailable'}</span>
          </div>
        </div>

        {onOpenRescue && (
          <div className="receipt-tab-action">
            <button
              type="button"
              className="btn-open-scenario"
              onClick={onOpenRescue}
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
            <span className="badge-airgap-status quarantined">Configuration package</span>
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
              <strong>Reported author:</strong> {pkg.authorOperator || 'Operator'} ({pkg.authorDeviceId || parsedEnvelope.originDeviceId})
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
            <span aria-hidden="true">●</span>
            <span><strong>Package details from received text</strong></span>
          </div>
          <div className="prov-details mono">
            <span>Asset SHA-256 Digest: {pkg.contentDigestSha256 ?? 'Unavailable'}</span>
          </div>
        </div>

        <details className="raw-details-toggle">
          <summary>Technical Envelope JSON (click to inspect wire payload)</summary>
          <pre className="raw-json-block mono">{text}</pre>
        </details>
      </div>
    );
  }

  // 3. SUPPLY CHAIN CUSTODY HANDOVER
  if (parsedEnvelope && (parsedEnvelope.messageType === 'trace_handover' || parsedEnvelope.messageType === 'trace_acceptance')) {
    const payload = parsedEnvelope.payload as Partial<ShipmentRecord & HandoverEvent>;
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
            <span aria-hidden="true">●</span>
            <span><strong>Custody details from received text</strong></span>
          </div>
          <div className="prov-details mono">
            <span>Holder Device: <code>{payload.currentHolderDeviceId || payload.toDeviceId || parsedEnvelope.originDeviceId}</code></span>
          </div>
        </div>

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
