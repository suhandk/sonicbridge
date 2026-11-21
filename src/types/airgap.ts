export type AssetCategory =
  | 'turbine'
  | 'plc'
  | 'generator'
  | 'pump'
  | 'robotics'
  | 'switchgear'
  | 'other';

export interface AssetRecord {
  assetId: string;
  machineName: string;
  category: AssetCategory;
  location: string;
  manufacturer: string;
  currentConfigVersion: string;
  authorizedOperator: string;
  deviceId: string;
}

export interface ConfigPackage {
  packageId: string;
  targetAssetId: string;
  packageName: string;
  version: string;
  description: string;
  configData: string;
  contentDigestSha256: string;
  authorDeviceId: string;
  authorOperator: string;
  createdAt: number;
  expiresAt: number;
  quarantined: boolean;
  approvedBy?: string;
  approvedAt?: number;
  rejectedReason?: string;
}
