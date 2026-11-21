export type IncidentCategory =
  | 'medical'
  | 'search_rescue'
  | 'food_water'
  | 'shelter'
  | 'hazard'
  | 'logistics'
  | 'custom';

export type IncidentPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface ResourceItem {
  type: string;
  quantity: number;
  unit: string;
  urgency: 'Immediate' | 'Within 6h' | 'Within 24h';
}

export interface IncidentReport {
  incidentId: string;
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  locationDescription: string;
  gps?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  affectedCount: number;
  resources: ResourceItem[];
  description: string;
  reportingDeviceId: string;
  createdAt: number;
  expiresAt: number;
}
