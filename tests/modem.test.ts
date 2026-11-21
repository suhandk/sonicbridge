import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { byteLength, createModem, decodeFixture, type ModemFactory } from '../src/modem';
import { readWav, writeWav } from '../src/wav';
const require = createRequire(import.meta.url);
const factory = require('ggwave') as ModemFactory;

describe('actual locally bundled ggwave WASM', () => {
  it('ships the exact runtime tested, with embedded WASM', () => {
    const shipped = readFileSync('public/vendor/ggwave.js');
    expect(shipped.equals(readFileSync(require.resolve('ggwave')))).toBe(true);
    expect(shipped.toString()).toContain('data:application/octet-stream;base64,AGFzbQ');
  });
  for (const sampleRate of [44100, 48000]) {
    for (const text of ['SONICBRIDGE', 'नमस्ते 🌉 café 日本語', 'a'.repeat(140)]) {
      it(`encodes → chunked PCM → decodes ${byteLength(text)} UTF-8 bytes at ${sampleRate} Hz`, async () => {
        const tx = await createModem(sampleRate, factory), rx = await createModem(sampleRate, factory);
        try {
          const pcm = tx.encode(text);
          expect(pcm.length).toBeGreaterThan(sampleRate);
          expect(pcm.every(Number.isFinite)).toBe(true);
          expect(decodeFixture(rx, pcm)).toEqual([text]);
        } finally { tx.dispose(); rx.dispose(); }
      });
    }
  }
  it('decodes exported PCM16 WAV, preserving UTF-8 and rate', async () => {
    const tx = await createModem(48000, factory), rx = await createModem(48000, factory);
    try {
      const text = 'Sound → हवा 🔊';
      const wav = readWav(writeWav(tx.encode(text), 48000));
      expect(wav.sampleRate).toBe(48000);
      expect(decodeFixture(rx, wav.pcm)).toEqual([text]);
    } finally { tx.dispose(); rx.dispose(); }
  });
  it('rejects empty, oversized UTF-8, and disposed use', async () => {
    const modem = await createModem(48000, factory);
    expect(() => modem.encode('')).toThrow('1–140');
    expect(() => modem.encode('🌉'.repeat(36))).toThrow('1–140');
    modem.dispose(); modem.dispose();
    expect(() => modem.encode('hello')).toThrow('closed');
  });
  it('does not fabricate messages from silence', async () => {
    const rx = await createModem(48000, factory);
    try { expect(decodeFixture(rx, new Float32Array(48000))).toEqual([]); } finally { rx.dispose(); }
  });
});
describe('WAV validation', () => {
  it('rejects truncated and malformed chunks', () => {
    expect(() => readWav(new ArrayBuffer(20))).toThrow('Invalid WAV');
    const buffer = writeWav(new Float32Array(1024), 48000);
    new DataView(buffer).setUint32(40, 0xfffffff0, true);
    expect(() => readWav(buffer)).toThrow('Invalid WAV');
  });
  it('rejects stereo instead of misinterpreting PCM', () => {
    const buffer = writeWav(new Float32Array(100), 48000);
    new DataView(buffer).setUint16(22, 2, true);
    expect(() => readWav(buffer)).toThrow('Invalid WAV');
  });
});
