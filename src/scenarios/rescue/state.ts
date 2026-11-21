import type { IncidentReport, IncidentCategory, IncidentPriority, ResourceItem } from '../../types/rescue';
import { getStorage } from '../../security/storage-helper';

const STORAGE_KEY_RESCUE = 'sonicbridge_scenario_rescue';

export const DEMO_RESCUE_INCIDENT: IncidentReport = {
  incidentId: 'INC-SEC4-WATER-01',
  category: 'food_water',
  priority: 'Critical',
  title: 'Urgent Drinking Water Shortage - Sector 4 Relief Camp',
  locationDescription: 'Sector 4 Community Gymnasium, Relief Staging Ground',
  gps: {
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 8,
  },
  affectedCount: 150,
  resources: [
    { type: 'Potable Drinking Water', quantity: 50, unit: 'Litres', urgency: 'Immediate' },
    { type: 'Water Purification Tablets', quantity: 100, unit: 'Tabs', urgency: 'Within 6h' },
  ],
  description: 'Water storage container ruptured after power disruption. 150 displaced individuals need potable drinking water immediately.',
  reportingDeviceId: 'VOLUNTEER-FIELD-ALPHA',
  createdAt: Date.now(),
  expiresAt: Date.now() + 1000 * 60 * 60 * 12, // 12 hours
};

export class RescueStateManager {
  private reports: IncidentReport[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
    if (this.reports.length === 0) {
      this.reports = [{ ...DEMO_RESCUE_INCIDENT }];
      this.save();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }

  private load() {
    try {
      const raw = getStorage().getItem(STORAGE_KEY_RESCUE);
      if (raw) {
        this.reports = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to load rescue reports:', e);
    }
  }

  private save() {
    try {
      getStorage().setItem(STORAGE_KEY_RESCUE, JSON.stringify(this.reports));
    } catch (e) {
      console.error('Failed to save rescue reports:', e);
    }
  }

  getAll(): IncidentReport[] {
    // Deterministic priority sorting: Critical > High > Medium > Low, then newest first
    const priorityWeight: Record<IncidentPriority, number> = {
      Critical: 4,
      High: 3,
      Medium: 2,
      Low: 1,
    };
    return [...this.reports].sort((a, b) => {
      const diff = priorityWeight[b.priority] - priorityWeight[a.priority];
      if (diff !== 0) return diff;
      return b.createdAt - a.createdAt;
    });
  }

  addReport(report: IncidentReport) {
    const existingIndex = this.reports.findIndex(r => r.incidentId === report.incidentId);
    if (existingIndex >= 0) {
      this.reports[existingIndex] = report;
    } else {
      this.reports.unshift(report);
    }
    this.save();
    this.notify();
  }

  getStats() {
    const all = this.reports;
    return {
      total: all.length,
      critical: all.filter(r => r.priority === 'Critical').length,
      high: all.filter(r => r.priority === 'High').length,
      peopleAffected: all.reduce((sum, r) => sum + (r.affectedCount || 0), 0),
      activeResourceRequests: all.reduce((sum, r) => sum + (r.resources?.length || 0), 0),
    };
  }

  resetDemo() {
    this.reports = [{ ...DEMO_RESCUE_INCIDENT, createdAt: Date.now() }];
    this.save();
    this.notify();
  }
}

export const defaultRescueState = new RescueStateManager();
