import { sha256 } from '@noble/hashes/sha2.js';
import { MAX_TRANSFER_BYTES, MAX_PAYLOAD, HEADER_BYTES, CRC_BYTES, equalBytes } from './protocol';

export type ContentKind = 'text' | 'image' | 'file';
const kinds: ContentKind[] = ['text', 'image', 'file'];
export const FIXED_MANIFEST = 37; // version, kind, u16 content length, u8 name length, 32-byte SHA-256
const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
export function safeName(input: string) {
  let clean = input.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}. _-]/gu, '_').replace(/^[. ]+|[. ]+$/g, '');
  if (/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(?:\.|$)/i.test(clean)) clean = '_' + clean;
  let name = '', length = 0;
  for (const ch of clean) {
    length += utf8.encode(ch).length;
    if (length > 64) break;
    name += ch;
  }
  return name.replace(/[. ]+$/g, '') || 'attachment';
}
export const manifestSize = (name: string) => FIXED_MANIFEST + utf8.encode(safeName(name)).length;
export function packContent(kind: ContentKind, name: string, content: Uint8Array) {
  const filename = utf8.encode(safeName(name)), offset = FIXED_MANIFEST + filename.length;
  if (content.length + offset > MAX_TRANSFER_BYTES) throw new Error('Content and manifest exceed the 4096-byte transfer limit.');
  const body = new Uint8Array(offset + content.length);
  body.set([1, kinds.indexOf(kind) + 1, content.length >>> 8, content.length & 255, filename.length]);
  body.set(sha256(content), 5); body.set(filename, FIXED_MANIFEST); body.set(content, offset);
  return body;
}
export function readManifestHeader(prefix: Uint8Array, total: number) {
  if (prefix.length < 5 || total < FIXED_MANIFEST + 1 || total > MAX_TRANSFER_BYTES || prefix[0] !== 1) throw new Error('Invalid manifest version or size.');
  const kind = kinds[prefix[1] - 1], size = prefix[2] * 256 + prefix[3], namesize = prefix[4];
  const offset = FIXED_MANIFEST + namesize;
  if (!kind || !namesize || namesize > 64 || offset + size !== total) throw new Error('Invalid manifest lengths or type.');
  return { offset, kind };
}
export function verifyContent(body: Uint8Array) {
  const { offset, kind } = readManifestHeader(body, body.length);
  const name = decoder.decode(body.subarray(FIXED_MANIFEST, offset));
  if (safeName(name) !== name) throw new Error('Unsafe manifest filename.');
  const bytes = body.subarray(offset);
  if (!equalBytes(sha256(bytes), body.subarray(5, 37))) throw new Error('Whole-file SHA-256 mismatch.');
  const text = kind === 'text' ? decoder.decode(bytes) : undefined;
  return { name, kind, bytes, text };
}
export type VerifiedContent = ReturnType<typeof verifyContent>;
export interface Measurement { goodput: number; chunk: number; modelSeconds: number; elapsed: number }
// Fit to local 48 kHz AUDIBLE_FAST (and AUDIBLE_FASTEST) packet airtime.
export function estimateTransfer(bodySize: number, chunk = MAX_PAYLOAD, robust = false, fastest = false) {
  const count = Math.ceil(bodySize / chunk), frame = HEADER_BYTES + CRC_BYTES;
  const packets = 4 + count * 2 + (robust ? 2 : 0);
  const wireBytes = bodySize + packets * frame + 15 + 7 + 8 + 8 + (robust ? 2 : 0);
  const baseSeconds = packets * (0.896 + (fastest ? 0.25 : 0.5)) + wireBytes * 0.05974 + (robust ? count * 0.8 : 0);
  return { count, packets, wireBytes, seconds: fastest ? baseSeconds * 0.55 : baseSeconds };
}
