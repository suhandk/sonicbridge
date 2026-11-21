import type { AssetRecord, ConfigPackage } from '../../types/airgap';
import { getStorage } from '../../security/storage-helper';
import { calculateDigest } from '../../security/crypto';

const STORAGE_KEY_ASSETS = 'sonicbridge_scenario_airgap_assets';
const STORAGE_KEY_PACKAGES = 'sonicbridge_scenario_airgap_packages';

export const INITIAL_AIRGAP_ASSETS: AssetRecord[] = [
  {
    assetId: 'MACHINE-001',
    machineName: 'Primary Gas Turbine TG-01',
    category: 'turbine',
    location: 'Power Generation Hall B',
    manufacturer: 'HeavyPower Dynamic Systems',
    currentConfigVersion: 'v2.4.1',
    authorizedOperator: 'Senior Tech Lead #402',
    deviceId: 'OPERATOR-FIELD-DEV-01',
  },
  {
    assetId: 'PLC-PUMP-04',
    machineName: 'Cooling Loop Submersible Pump',
    category: 'pump',
    location: 'Auxiliary Cooling Sector 3',
    manufacturer: 'HydraFlow Industrial',
    currentConfigVersion: 'v1.8.0',
    authorizedOperator: 'Maintenance Tech #118',
    deviceId: 'OPERATOR-FIELD-DEV-02',
  },
];

export const DEMO_CONFIG_PACKAGE: ConfigPackage = {
  packageId: 'PKG-TG01-VIB-242',
  targetAssetId: 'MACHINE-001',
  packageName: 'Turbine Vibration Alarm Calibration & Low-Noise Profile',
  version: 'v2.4.2',
  description: 'Adjusts harmonic vibration shutdown threshold to 4.5 mm/s RMS and sets sampling filter window to 250ms.',
  configData: JSON.stringify(
    {
      target: 'MACHINE-001',
      max_vibration_rms: 4.5,
      shutdown_delay_ms: 300,
      filter_order: 4,
      profile: 'low-noise-adaptive',
    },
    null,
    2
  ),
  contentDigestSha256: '', // populated below
  authorDeviceId: 'AUTHORIZED-ENG-STATION-01',
  authorOperator: 'Staff Engineer A. Vance',
  createdAt: Date.now(),
  expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
  quarantined: true,
};
DEMO_CONFIG_PACKAGE.contentDigestSha256 = calculateDigest(DEMO_CONFIG_PACKAGE.configData);

export class AirGapStateManager {
  private assets: AssetRecord[] = [];
  private packages: ConfigPackage[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    this.load();
    if (this.assets.length === 0) {
      this.assets = [...INITIAL_AIRGAP_ASSETS];
      this.packages = [{ ...DEMO_CONFIG_PACKAGE }];
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
      const aRaw = getStorage().getItem(STORAGE_KEY_ASSETS);
      if (aRaw) this.assets = JSON.parse(aRaw);
      const pRaw = getStorage().getItem(STORAGE_KEY_PACKAGES);
      if (pRaw) this.packages = JSON.parse(pRaw);
    } catch (e) {
      console.warn('Failed to load airgap data:', e);
    }
  }

  private save() {
    try {
      getStorage().setItem(STORAGE_KEY_ASSETS, JSON.stringify(this.assets));
      getStorage().setItem(STORAGE_KEY_PACKAGES, JSON.stringify(this.packages));
    } catch (e) {
      console.error('Failed to save airgap data:', e);
    }
  }

  getAssets(): AssetRecord[] {
    return this.assets;
  }

  getPackages(): ConfigPackage[] {
    return [...this.packages].sort((a, b) => b.createdAt - a.createdAt);
  }

  addPackage(pkg: ConfigPackage) {
    const idx = this.packages.findIndex(p => p.packageId === pkg.packageId);
    if (idx >= 0) {
      this.packages[idx] = pkg;
    } else {
      this.packages.unshift(pkg);
    }
    this.save();
    this.notify();
  }

  approvePackage(packageId: string, approvedBy: string): boolean {
    const pkg = this.packages.find(p => p.packageId === packageId);
    if (!pkg) return false;
    pkg.quarantined = false;
    pkg.approvedBy = approvedBy;
    pkg.approvedAt = Date.now();
    // Update asset version
    const asset = this.assets.find(a => a.assetId === pkg.targetAssetId);
    if (asset) asset.currentConfigVersion = pkg.version;
    this.save();
    this.notify();
    return true;
  }

  rejectPackage(packageId: string, reason: string): boolean {
    const pkg = this.packages.find(p => p.packageId === packageId);
    if (!pkg) return false;
    pkg.quarantined = true;
    pkg.rejectedReason = reason;
    this.save();
    this.notify();
    return true;
  }

  getStats() {
    return {
      totalAssets: this.assets.length,
      totalPackages: this.packages.length,
      quarantined: this.packages.filter(p => p.quarantined && !p.rejectedReason).length,
      approved: this.packages.filter(p => !p.quarantined).length,
      rejected: this.packages.filter(p => !!p.rejectedReason).length,
    };
  }

  resetDemo() {
    this.assets = [...INITIAL_AIRGAP_ASSETS];
    const demoPkg = { ...DEMO_CONFIG_PACKAGE, createdAt: Date.now() };
    demoPkg.contentDigestSha256 = calculateDigest(demoPkg.configData);
    this.packages = [demoPkg];
    this.save();
    this.notify();
  }
}

export const defaultAirGapState = new AirGapStateManager();
