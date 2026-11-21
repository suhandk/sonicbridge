import { deriveFingerprint, exportPrivateKey, exportPublicKey, generateKeyPair, importPrivateKey, importPublicKey } from './crypto';
import { getStorage } from './storage-helper';
import type { DeviceIdentity } from '../types/identity';

export interface LocalDeviceKeys {
  identity: DeviceIdentity;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

const STORAGE_KEY_IDENTITY = 'sonicbridge_device_identity';
const STORAGE_KEY_PRIV_KEY = 'sonicbridge_device_privkey';

/**
 * Initializes or loads the persistent local device identity.
 */
export async function getOrCreateDeviceIdentity(customName?: string): Promise<LocalDeviceKeys> {
  const storage = getStorage();
  try {
    const storedIdentityStr = storage.getItem(STORAGE_KEY_IDENTITY);
    const storedPrivKeyStr = storage.getItem(STORAGE_KEY_PRIV_KEY);

    if (storedIdentityStr && storedPrivKeyStr) {
      const identity = JSON.parse(storedIdentityStr) as DeviceIdentity;
      const privKeyJwk = JSON.parse(storedPrivKeyStr) as JsonWebKey;
      const publicKey = await importPublicKey(identity.publicKeyJwk);
      const privateKey = await importPrivateKey(privKeyJwk);
      if (customName && identity.name !== customName) {
        identity.name = customName;
        storage.setItem(STORAGE_KEY_IDENTITY, JSON.stringify(identity));
      }
      return { identity, publicKey, privateKey };
    }
  } catch (err) {
    console.warn('Failed to load device identity from storage, generating new one:', err);
  }

  // Generate new identity
  const keyPair = await generateKeyPair();
  const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
  const privateKeyJwk = await exportPrivateKey(keyPair.privateKey);
  const fingerprint = deriveFingerprint(publicKeyJwk);

  const defaultName = customName || `Node-${fingerprint.slice(0, 6).toUpperCase()}`;
  const identity: DeviceIdentity = {
    id: fingerprint,
    name: defaultName,
    fingerprint,
    publicKeyJwk,
    createdAt: Date.now(),
  };

  try {
    storage.setItem(STORAGE_KEY_IDENTITY, JSON.stringify(identity));
    storage.setItem(STORAGE_KEY_PRIV_KEY, JSON.stringify(privateKeyJwk));
  } catch (err) {
    console.error('Failed to persist device identity to storage:', err);
  }

  return {
    identity,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}
