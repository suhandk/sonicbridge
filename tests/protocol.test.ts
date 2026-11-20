import { describe, expect, it } from 'vitest';
import { crc32, decodePacket, encodePacket, Kind, MAX_PAYLOAD, offerBytes, payloadCapacity, readOffer } from '../src/protocol';
const packet = () => ({ kind: Kind.DATA, session: 0x12345678, transfer: 0xabcdef01, seq: 256, payload: Uint8Array.from({ length: MAX_PAYLOAD }, (_, i) => i * 17) });
describe('versioned binary packet codec', () => {
  it('uses big-endian headers, IEEE CRC32, and the entire modem budget', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const p = packet(), bytes = encodePacket(p);
    expect(bytes.length).toBe(140); expect(MAX_PAYLOAD).toBe(120); expect(payloadCapacity(80)).toBe(60);
    expect([...bytes.subarray(0, 16)]).toEqual([0x53, 0x42, 1, 3, 0x12, 0x34, 0x56, 0x78, 0xab, 0xcd, 0xef, 1, 1, 0, 0, 120]);
    expect(decodePacket(bytes)).toEqual(p);
  });
  it('rejects single-byte corruption anywhere in header, payload or CRC', () => {
    const bytes = encodePacket(packet());
    for (let i = 0; i < bytes.length; i++) {
      const corrupt = bytes.slice(); corrupt[i] ^= 1;
      expect(() => decodePacket(corrupt), `byte ${i}`).toThrow();
    }
  });
  it('rejects unsupported versions, declared lengths, extra bytes, invalid IDs and types', () => {
    const bytes = encodePacket(packet());
    const version = bytes.slice(); version[2] = 2; expect(() => decodePacket(version)).toThrow('version');
    const length = bytes.slice(); length[14] = 255; expect(() => decodePacket(length)).toThrow('length');
    expect(() => decodePacket(bytes.subarray(0, 30))).toThrow();
    expect(() => decodePacket(new Uint8Array(141))).toThrow();
    expect(() => encodePacket({ ...packet(), session: 0 })).toThrow();
    expect(() => encodePacket({ ...packet(), kind: 99 as Kind })).toThrow();
    expect(() => encodePacket({ ...packet(), payload: new Uint8Array(121) })).toThrow();
    expect(() => encodePacket({ ...packet(), kind: Kind.ACK })).toThrow();
  });
  it('rejects excessive capability/resource requests before reassembly', () => {
    for (const total of [0, 4097, 0xffffffff]) expect(() => readOffer(offerBytes({ total, checksum: 0, chunk: 120, maxTransfer: total }))).toThrow();
    expect(() => readOffer(offerBytes({ total: 1, checksum: 0, chunk: 121, maxTransfer: 4096 }))).toThrow();
  });
});
