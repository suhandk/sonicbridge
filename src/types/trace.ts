export interface ShipmentRecord {
  shipmentId: string;
  packageId: string;
  itemDescription: string;
  quantity: number;
  unit: string;
  senderOrganization: string;
  intendedReceiver: string;
  originLocation: string;
  destinationLocation: string;
  createdAt: number;
  expectedDeliveryAt: number;
  currentHolderDeviceId: string;
}

export type HandoverStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface HandoverEvent {
  handoverId: string;
  shipmentId: string;
  fromDeviceId: string;
  toDeviceId: string;
  location: string;
  timestamp: number;
  status: HandoverStatus;
  acceptanceReceiptId?: string;
  signature: string;
  notes?: string;
}

export interface CustodyChain {
  shipment: ShipmentRecord;
  handovers: HandoverEvent[];
}
