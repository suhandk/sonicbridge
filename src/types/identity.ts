export interface DeviceIdentity {
  id: string; // SHA-256 fingerprint (first 16 hex chars)
  name: string;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  createdAt: number;
}

export type TrustLevel = 'verified' | 'untrusted' | 'revoked';

export interface TrustedDevice {
  id: string;
  name: string;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  trustLevel: TrustLevel;
  enrolledAt: number;
  notes?: string;
}

export interface EnrollmentPayload {
  version: 1;
  id: string;
  name: string;
  fingerprint: string;
  publicKeyJwk: JsonWebKey;
  timestamp: number;
}
