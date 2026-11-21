import React, { useState, useEffect } from 'react';
import type { IncidentReport, IncidentCategory, IncidentPriority, ResourceItem } from '../types/rescue';
import { defaultRescueState } from '../scenarios/rescue/state';
import type { AcousticBridge } from '../bridge/acoustic-bridge';

interface RescueViewProps {
  bridge: AcousticBridge;
  onSendPayload: (bytes: Uint8Array, description: string) => Promise<void>;
  currentDeviceId: string;
}

export function RescueView({ bridge, onSendPayload, currentDeviceId }: RescueViewProps) {
  const [reports, setReports] = useState<IncidentReport[]>(defaultRescueState.getAll());
  const [stats, setStats] = useState(defaultRescueState.getStats());
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [isComposing, setIsComposing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Form state
  const [category, setCategory] = useState<IncidentCategory>('food_water');
  const [priority, setPriority] = useState<IncidentPriority>('Critical');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [affected, setAffected] = useState(50);
  const [resourceType, setResourceType] = useState('Drinking Water');
  const [resourceQty, setResourceQty] = useState(50);
  const [resourceUnit, setResourceUnit] = useState('Litres');
  const [description, setDescription] = useState('');
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    return defaultRescueState.subscribe(() => {
      setReports(defaultRescueState.getAll());
      setStats(defaultRescueState.getStats());
    });
  }, []);

  const handleGetLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setGps({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          setStatusMessage('GPS coordinates acquired.');
        },
        () => setStatusMessage('GPS permission unavailable or denied. Location description can be entered manually.')
      );
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !location) {
      setStatusMessage('Please provide title and location description.');
      return;
    }

    const report: IncidentReport = {
      incidentId: `INC-${Date.now().toString(36).toUpperCase()}`,
      category,
      priority,
      title,
      locationDescription: location,
      gps: gps || undefined,
      affectedCount: Number(affected),
      resources: [
        {
          type: resourceType,
          quantity: Number(resourceQty),
          unit: resourceUnit,
          urgency: priority === 'Critical' ? 'Immediate' : 'Within 6h',
        },
      ],
      description,
      reportingDeviceId: currentDeviceId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 1000 * 60 * 60 * 24, // 24 hours
    };

    defaultRescueState.addReport(report);
    setIsComposing(false);
    setStatusMessage(`Incident report ${report.incidentId} created locally.`);

    // Transmit acoustically
    try {
      setStatusMessage('Signing report and preparing acoustic packet transmission...');
      const { packedBytes } = await bridge.composeAndQueue('rescue_incident', report);
      await onSendPayload(packedBytes, `Rescue Report: ${report.title}`);
      setStatusMessage(`Acoustic broadcast initiated for incident ${report.incidentId}.`);
    } catch (err) {
      setStatusMessage(`Failed to send report: ${String(err)}`);
    }
  };

  const handleTransmitReport = async (report: IncidentReport) => {
    try {
      setStatusMessage(`Packaging and signing ${report.incidentId}...`);
      const { packedBytes } = await bridge.composeAndQueue('rescue_incident', report);
      await onSendPayload(packedBytes, `Rescue: ${report.title}`);
      setStatusMessage(`Acoustic broadcast initiated for ${report.incidentId}.`);
    } catch (err) {
      setStatusMessage(`Transmission error: ${String(err)}`);
    }
  };

  const filteredReports = filterPriority === 'All'
    ? reports
    : reports.filter(r => r.priority === filterPriority);

  return (
    <div className="scenario-view rescue-theme">
      {/* Scenario Header */}
      <div className="scenario-header">
        <div>
          <h2>SONICBRIDGE RESCUE</h2>
          <p className="scenario-tagline">"Communication when infrastructure fails."</p>
        </div>
        <div className="scenario-actions">
          <button className="btn-secondary" onClick={() => {
            if (window.confirm('Replace locally saved incident reports with sample data?')) {
              defaultRescueState.resetDemo();
              setStatusMessage('Sample data restored.');
            }
          }}>
            Load Demo Preset
          </button>
          <button className="btn-primary" aria-expanded={isComposing} onClick={() => setIsComposing(!isComposing)}>
            {isComposing ? 'Cancel Compose' : '+ Report Incident'}
          </button>
        </div>
      </div>

      <div className={statusMessage ? "status-banner info" : undefined} role="status">{statusMessage}</div>

      {/* Emergency Command Dashboard Stats */}
      <div className="dashboard-metrics">
        <div className="metric-card">
          <span className="metric-label">Total Reports</span>
          <span className="metric-value">{stats.total}</span>
        </div>
        <div className="metric-card critical">
          <span className="metric-label">Critical Incidents</span>
          <span className="metric-value">{stats.critical}</span>
        </div>
        <div className="metric-card high">
          <span className="metric-label">High Priority</span>
          <span className="metric-value">{stats.high}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">People Affected</span>
          <span className="metric-value">{stats.peopleAffected}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Resource Demands</span>
          <span className="metric-value">{stats.activeResourceRequests} items</span>
        </div>
      </div>

      {/* Compose Incident Form */}
      {isComposing && (
        <form className="console-form" onSubmit={handleSubmit}>
          <h3>New Emergency Incident Report</h3>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="incident-category">Category</label>
              <select id="incident-category" value={category} onChange={e => setCategory(e.target.value as IncidentCategory)}>
                <option value="food_water">Food & Water</option>
                <option value="medical">Medical / Triage</option>
                <option value="search_rescue">Search & Rescue</option>
                <option value="shelter">Temporary Shelter</option>
                <option value="hazard">Hazard / Fire / Flood</option>
                <option value="logistics">Logistics / Route Blockage</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="incident-priority">Priority Level</label>
              <select id="incident-priority" value={priority} onChange={e => setPriority(e.target.value as IncidentPriority)}>
                <option value="Critical">Critical (Immediate)</option>
                <option value="High">High (Within 6h)</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="incident-title">Incident Summary Title</label>
            <input id="incident-title"
              type="text"
              placeholder="e.g. Drinking water required for 150 refugees"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="incident-location">Location Description</label>
              <input id="incident-location"
                type="text"
                placeholder="Sector 4 Community Gymnasium"
                value={location}
                onChange={e => setLocation(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <span className="form-label">GPS coordinates</span>
              <button type="button" className="btn-secondary" onClick={handleGetLocation}>
                {gps ? `Update GPS (${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)})` : 'Get GPS coordinates'}
              </button>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="incident-affected">People Affected</label>
              <input id="incident-affected"
                type="number"
                value={affected}
                onChange={e => setAffected(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="form-group">
              <label htmlFor="incident-resource">Required Resource</label>
              <input id="incident-resource"
                type="text"
                value={resourceType}
                onChange={e => setResourceType(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label htmlFor="incident-quantity">Quantity</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  id="incident-quantity" type="number"
                  value={resourceQty}
                  onChange={e => setResourceQty(Number(e.target.value))}
                  style={{ width: '80px' }}
                />
                <input
                  aria-label="Unit" type="text"
                  value={resourceUnit}
                  onChange={e => setResourceUnit(e.target.value)}
                  style={{ width: '80px' }}
                />
              </div>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="incident-description">Detailed Description</label>
            <textarea id="incident-description"
              rows={3}
              placeholder="Detailed assessment of conditions, hazards, and access routes..."
              value={description}
              onChange={e => setDescription(e.target.value)}
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

      {/* Incident List with Filters */}
      <div className="reports-section">
        <div className="section-toolbar">
          <h3>Incident Ledger ({filteredReports.length})</h3>
          <div className="filter-group">
            <span>Filter Priority:</span>
            {['All', 'Critical', 'High', 'Medium', 'Low'].map(p => (
              <button
                key={p}
                className={`btn-filter ${filterPriority === p ? 'active' : ''}`}
                onClick={() => setFilterPriority(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="report-cards-grid">
          {filteredReports.map(report => (
            <div key={report.incidentId} className={`report-card priority-${report.priority.toLowerCase()}`}>
              <div className="report-card-header">
                <span className={`badge-priority ${report.priority.toLowerCase()}`}>
                  {report.priority}
                </span>
                <span className="badge-category">{report.category}</span>
                <span className="report-time">{new Date(report.createdAt).toLocaleTimeString()}</span>
              </div>
              <h4 className="report-title">{report.title}</h4>
              <p className="report-location">📍 {report.locationDescription}</p>
              {report.gps && (
                <p className="report-gps">GPS: {report.gps.latitude.toFixed(4)}, {report.gps.longitude.toFixed(4)}</p>
              )}
              <p className="report-desc">{report.description}</p>

              {report.resources && report.resources.length > 0 && (
                <div className="resources-list">
                  <strong>Required Resources:</strong>
                  {report.resources.map((res, i) => (
                    <div key={i} className="resource-pill">
                      {res.quantity} {res.unit} - {res.type} ({res.urgency})
                    </div>
                  ))}
                </div>
              )}

              <div className="report-card-footer">
                <span className="reporter-id">Sender: {report.reportingDeviceId}</span>
                <button
                  className="btn-transmit-acoustic"
                  onClick={() => handleTransmitReport(report)}
                >
                  🔊 Transmit via Sound
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
