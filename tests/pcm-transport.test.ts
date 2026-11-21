import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createModem, decodeBinaryFixture, type ModemFactory } from '../src/modem';
import { decodePacket, encodePacket, Kind, MAX_PAYLOAD } from '../src/protocol';
import { simulateTransfer } from '../src/simulation';
const factory = createRequire(import.meta.url)('ggwave') as ModemFactory;
it('round trips a maximum binary packet through actual WASM/PCM including NUL and invalid UTF-8 bytes', async () => {
  for (const rate of [44100, 48000]) {
    const tx = await createModem(rate, factory), rx = await createModem(rate, factory);
    try {
      const packet = { kind: Kind.DATA, session: 1, transfer: 2, seq: 0, payload: Uint8Array.from({ length: MAX_PAYLOAD }, (_, i) => i * 31) };
      const encoded = encodePacket(packet), pcm = tx.encodeBytes(encoded), decoded = decodeBinaryFixture(rx, pcm);
      expect(pcm.length / rate).toBeLessThan(30);
      expect(decoded).toEqual([encoded]); expect(decodePacket(decoded[0])).toEqual(packet);
    } finally { tx.dispose(); rx.dispose(); }
  }
});
it('completes HELLO/CAPS, multi-chunk DATA/ACK and FIN/FIN_ACK through real codec-generated PCM in both directions', async () => {
  const data = new TextEncoder().encode('नमस्ते 🌉 café 日本語 '.repeat(4));
  const delivered = await simulateTransfer(data, { factory });
  expect(delivered).toEqual([data]);
}, 30000);
