import { MAX_BYTES } from './modem';

export const VERSION = 1;
export const HEADER_BYTES = 16;
export const CRC_BYTES = 4;
export const MAX_TRANSFER_BYTES = 4096;
export const MAX_CHUNKS = 128;
export const BASELINE = 1; // ggwave audible family, variable length, no DSS. Fast is the default.
export enum Kind { HELLO = 1, CAPS, DATA, ACK, FIN, FIN_ACK, CANCEL, CONTENT_HELLO, CONTENT_CAPS, CONTENT_DATA_ALT, SET_POLICY, POLICY_ACK, SHORT_TEXT }
export interface Packet { kind: Kind; session: number; transfer: number; seq: number; payload: Uint8Array }
export function payloadCapacity(limit = MAX_BYTES) {
  if (!Number.isInteger(limit) || limit < HEADER_BYTES + CRC_BYTES + 15 || limit > MAX_BYTES) throw new Error('Unsupported decoded modem limit.');
  return limit - HEADER_BYTES - CRC_BYTES;
}
export const MAX_PAYLOAD = payloadCapacity();
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function shape(kind: Kind, length: number) {
  const sizes: Partial<Record<Kind, number>> = { [Kind.HELLO]: 15, [Kind.CAPS]: 7, [Kind.ACK]: 0, [Kind.FIN]: 8, [Kind.FIN_ACK]: 8, [Kind.CANCEL]: 0, [Kind.CONTENT_HELLO]: 15, [Kind.CONTENT_CAPS]: 7, [Kind.SET_POLICY]: 1, [Kind.POLICY_ACK]: 1 };
  const variable = kind === Kind.DATA || kind === Kind.CONTENT_DATA_ALT || kind === Kind.SHORT_TEXT;
  if (kind < Kind.HELLO || kind > Kind.SHORT_TEXT || !Number.isInteger(kind) || (variable ? length < 1 : length !== sizes[kind])) throw new Error('Invalid packet type or payload length.');
}
const startsAtZero = (kind: Kind) => kind === Kind.HELLO || kind === Kind.CAPS || kind === Kind.CONTENT_HELLO || kind === Kind.CONTENT_CAPS || kind === Kind.SHORT_TEXT;
function uint(value: number, max: number, nonzero = false) {
  if (!Number.isInteger(value) || value < (nonzero ? 1 : 0) || value > max) throw new Error('Invalid packet identifier.');
}
export function encodePacket(p: Packet, limit = MAX_BYTES): Uint8Array {
  if (p.payload.length > payloadCapacity(limit)) throw new Error('Packet exceeds decoded modem limit.');
  uint(p.session, 0xffffffff, true); uint(p.transfer, 0xffffffff, true); uint(p.seq, 0xffff); shape(p.kind, p.payload.length);
  if (startsAtZero(p.kind) && p.seq !== 0) throw new Error('Invalid opening sequence.');
  const bytes = new Uint8Array(HEADER_BYTES + p.payload.length + CRC_BYTES), v = new DataView(bytes.buffer);
  v.setUint16(0, 0x5342); v.setUint8(2, VERSION); v.setUint8(3, p.kind);
  v.setUint32(4, p.session); v.setUint32(8, p.transfer); v.setUint16(12, p.seq); v.setUint16(14, p.payload.length);
  bytes.set(p.payload, HEADER_BYTES); v.setUint32(bytes.length - CRC_BYTES, crc32(bytes.subarray(0, -CRC_BYTES)));
  return bytes;
}
export function decodePacket(bytes: Uint8Array, limit = MAX_BYTES): Packet {
  // Validate all declared lengths against actual bytes BEFORE returning any payload view.
  payloadCapacity(limit);
  if (bytes.length < HEADER_BYTES + CRC_BYTES || bytes.length > limit) throw new Error('Invalid packet length.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0) !== 0x5342) throw new Error('Invalid packet magic.');
  if (v.getUint8(2) !== VERSION) throw new Error('Unsupported packet version.');
  const kind = v.getUint8(3), length = v.getUint16(14), seq = v.getUint16(12);
  if (length > payloadCapacity(limit) || bytes.length !== HEADER_BYTES + length + CRC_BYTES) throw new Error('Invalid declared payload length.');
  shape(kind, length);
  const session = v.getUint32(4), transfer = v.getUint32(8);
  uint(session, 0xffffffff, true); uint(transfer, 0xffffffff, true);
  if (startsAtZero(kind) && seq !== 0) throw new Error('Invalid opening sequence.');
  if (v.getUint32(bytes.length - CRC_BYTES) !== crc32(bytes.subarray(0, -CRC_BYTES))) throw new Error('Packet CRC32 mismatch.');
  return { kind, session, transfer, seq, payload: bytes.subarray(HEADER_BYTES, -CRC_BYTES) };
}
export interface Offer { total: number; checksum: number; chunk: number; maxTransfer: number }
export function offerBytes(o: Offer) {
  const bytes = new Uint8Array(15), v = new DataView(bytes.buffer);
  v.setUint32(0, o.total); v.setUint32(4, o.checksum); v.setUint16(8, o.chunk); v.setUint32(10, o.maxTransfer); v.setUint8(14, BASELINE);
  return bytes;
}
export function readOffer(bytes: Uint8Array): Offer {
  if (bytes.length !== 15) throw new Error('Invalid HELLO.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const o = { total: v.getUint32(0), checksum: v.getUint32(4), chunk: v.getUint16(8), maxTransfer: v.getUint32(10) };
  if (v.getUint8(14) !== BASELINE || o.total < 1 || o.total > MAX_TRANSFER_BYTES || o.maxTransfer < o.total || o.maxTransfer > MAX_TRANSFER_BYTES || o.chunk < 1 || o.chunk > MAX_PAYLOAD || Math.ceil(o.total / o.chunk) > MAX_CHUNKS) throw new Error('Unsupported capabilities or excessive transfer request.');
  return o;
}
export function capsBytes(chunk: number, maxTransfer: number) {
  const bytes = new Uint8Array(7), v = new DataView(bytes.buffer);
  v.setUint16(0, chunk); v.setUint32(2, maxTransfer); v.setUint8(6, BASELINE); return bytes;
}
export function readCaps(bytes: Uint8Array) {
  if (bytes.length !== 7) throw new Error('Invalid CAPS.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunk = v.getUint16(0), maxTransfer = v.getUint32(2);
  if (chunk < 1 || chunk > MAX_PAYLOAD || maxTransfer < 1 || maxTransfer > MAX_TRANSFER_BYTES || v.getUint8(6) !== BASELINE) throw new Error('Unsupported negotiated capabilities.');
  return { chunk, maxTransfer };
}
export function finishBytes(total: number, checksum: number) {
  const bytes = new Uint8Array(8), v = new DataView(bytes.buffer);
  v.setUint32(0, total); v.setUint32(4, checksum); return bytes;
}
export const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

// Length-preserving whitening for negotiated content DATA. Both directions use XOR.
// A second mask on alternate attempts changes the waveform for difficult byte patterns.
export function contentMask(p: Packet): Uint8Array {
  let state = (Math.imul(p.session, 0x85ebca6b) ^ p.transfer ^ Math.imul(p.seq + 1, 0x9e3779b1)
    ^ (p.kind === Kind.CONTENT_DATA_ALT ? 0x27d4eb2f : 0)) >>> 0 || 1;
  return p.payload.map(byte => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return byte ^ (state >>> 24);
  });
}
