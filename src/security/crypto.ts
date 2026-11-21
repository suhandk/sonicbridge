import { sha256 } from '@noble/hashes/sha2.js';
import { canonicalJson } from './canonical';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string.');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Calculates SHA-256 digest of arbitrary payload object using canonical serialization.
 */
export function calculateDigest(payload: unknown): string {
  const canonical = canonicalJson(payload);
  const bytes = textEncoder.encode(canonical);
  const hash = sha256(bytes);
  return toHex(hash);
}

/**
 * Generates an ECDSA P-256 key pair for signing and verification.
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true, // extractable
    ['sign', 'verify']
  );
}

/**
 * Exports a public CryptoKey to standard JWK format.
 */
export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey('jwk', key);
}

/**
 * Exports a private CryptoKey to JWK format.
 */
export async function exportPrivateKey(key: CryptoKey): Promise<JsonWebKey> {
  return await crypto.subtle.exportKey('jwk', key);
}

/**
 * Imports a public key from JWK format.
 */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['verify']
  );
}

/**
 * Imports a private key from JWK format.
 */
export async function importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign']
  );
}

/**
 * Derives a human-readable 16-character hex fingerprint from a public key JWK.
 */
export function deriveFingerprint(jwk: JsonWebKey): string {
  // Use canonical representation of x and y coordinates
  const coordData = `${jwk.crv}:${jwk.x}:${jwk.y}`;
  const hash = sha256(textEncoder.encode(coordData));
  return toHex(hash).slice(0, 16);
}

/**
 * Digitally signs data using an ECDSA P-256 private key.
 */
export async function signData(privateKey: CryptoKey, data: Uint8Array): Promise<string> {
  const signatureBuffer = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    privateKey,
    data as unknown as BufferSource
  );
  return toBase64(new Uint8Array(signatureBuffer));
}

/**
 * Verifies an ECDSA P-256 signature against data.
 */
export async function verifySignature(
  publicKey: CryptoKey,
  signatureBase64: string,
  data: Uint8Array
): Promise<boolean> {
  try {
    const sigBytes = fromBase64(signatureBase64);
    return await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' },
      },
      publicKey,
      sigBytes as unknown as BufferSource,
      data as unknown as BufferSource
    );
  } catch {
    return false;
  }
}
