import type { ShipmentRecord, HandoverEvent, CustodyChain } from '../../types/trace';
import { getStorage } from '../../security/storage-helper';

const STORAGE_KEY_SHIPMENTS = 'sonicbridge_scenario_trace_shipments';
const STORAGE_KEY_HANDOVERS = 'sonicbridge_scenario_trace_handovers';

export const DEMO_SHIPMENT: ShipmentRecord = {
  shipmentId: 'SHIP-VAX-COLD-902',
  packageId: 'PKG-VACCINE-LOT-B4',
  itemDescription: 'Emergency Typhoid & Cholera Vaccine Vials (Temperature Controlled 2-8°C)',
  quantity: 250,
  unit: 'Doses',
  senderOrganization: 'Regional Public Health Depot (Warehouse A)',
  intendedReceiver: 'Field Emergency Treatment Center (Hospital C)',
  originLocation: 'Central Supply Warehouse Dock 4',
  destinationLocation: 'District Field Hospital Receiving',
  createdAt: Date.now(),
  expectedDeliveryAt: Date.now() + 1000 * 60 * 60 * 36, // 36 hours
  currentHolderDeviceId: 'WH-A-DEPOT-DISPATCH-01',
};

export const DEMO_INITIAL_HANDOVER: HandoverEvent = {
  handoverId: 'HO-001-DEPOT-RELEASE',
  shipmentId: 'SHIP-VAX-COLD-902',
  fromDeviceId: 'WH-A-DEPOT-DISPATCH-01',
  toDeviceId: 'LOGISTICS-TRANSIT-VAN-04',
  location: 'Central Depot Gate 3',
  timestamp: Date.now() - 1000 * 60 * 45, // 45m ago
  status: 'ACCEPTED',
  signature: 'SIG_DEMO_HANDOVER_INITIAL_DEPOT',
  notes: 'Cold box seal verified intact at +4.2°C.',
};

export class TraceStateManager {
  private shipments: ShipmentRecord[] = [];
  private handovers: HandoverEvent[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
    if (this.shipments.length === 0) {
      this.shipments = [{ ...DEMO_SHIPMENT }];
      this.handovers = [{ ...DEMO_INITIAL_HANDOVER }];
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
      const sRaw = getStorage().getItem(STORAGE_KEY_SHIPMENTS);
      if (sRaw) this.shipments = JSON.parse(sRaw);
      const hRaw = getStorage().getItem(STORAGE_KEY_HANDOVERS);
      if (hRaw) this.handovers = JSON.parse(hRaw);
    } catch (e) {
      console.warn('Failed to load trace data:', e);
    }
  }

  private save() {
    try {
      getStorage().setItem(STORAGE_KEY_SHIPMENTS, JSON.stringify(this.shipments));
      getStorage().setItem(STORAGE_KEY_HANDOVERS, JSON.stringify(this.handovers));
    } catch (e) {
      console.error('Failed to save trace data:', e);
    }
  }

  getShipments(): ShipmentRecord[] {
    return [...this.shipments].sort((a, b) => b.createdAt - a.createdAt);
  }

  getHandovers(shipmentId?: string): HandoverEvent[] {
    const list = shipmentId ? this.handovers.filter(h => h.shipmentId === shipmentId) : this.handovers;
    return [...list].sort((a, b) => a.timestamp - b.timestamp);
  }

  getCustodyChain(shipmentId: string): CustodyChain | undefined {
    const shipment = this.shipments.find(s => s.shipmentId === shipmentId);
    if (!shipment) return undefined;
    const handovers = this.getHandovers(shipmentId);
    return { shipment, handovers };
  }

  addShipment(shipment: ShipmentRecord) {
    const idx = this.shipments.findIndex(s => s.shipmentId === shipment.shipmentId);
    if (idx >= 0) this.shipments[idx] = shipment;
    else this.shipments.unshift(shipment);
    this.save();
    this.notify();
  }

  addHandover(handover: HandoverEvent) {
    // Duplicate prevention: check handoverId
    if (this.handovers.some(h => h.handoverId === handover.handoverId)) {
      throw new Error(`Duplicate handover ID (${handover.handoverId}) already recorded.`);
    }
    this.handovers.push(handover);
    // Update current holder of shipment
    const shipment = this.shipments.find(s => s.shipmentId === handover.shipmentId);
    if (shipment && handover.status === 'ACCEPTED') {
      shipment.currentHolderDeviceId = handover.toDeviceId;
    }
    this.save();
    this.notify();
  }

  getStats() {
    return {
      activeShipments: this.shipments.length,
      totalHandovers: this.handovers.length,
      acceptedHandovers: this.handovers.filter(h => h.status === 'ACCEPTED').length,
      rejectedHandovers: this.handovers.filter(h => h.status === 'REJECTED').length,
    };
  }

  resetDemo() {
    this.shipments = [{ ...DEMO_SHIPMENT, createdAt: Date.now() }];
    this.handovers = [{ ...DEMO_INITIAL_HANDOVER, timestamp: Date.now() - 1000 * 60 * 15 }];
    this.save();
    this.notify();
  }
}

export const defaultTraceState = new TraceStateManager();
