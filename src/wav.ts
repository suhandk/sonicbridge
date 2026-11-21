export interface Wav { pcm: Float32Array; sampleRate: number }
export function writeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buffer);
  const str = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, buffer.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((s, i) => v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * (s < 0 ? 32768 : 32767)), true));
  return buffer;
}
export function readWav(buffer: ArrayBuffer): Wav {
  const fail = () => new Error('Invalid WAV. Use mono PCM16 or float32 WAV at 8–96 kHz.');
  if (buffer.byteLength < 44) throw fail();
  const v = new DataView(buffer);
  const str = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buffer, at, n));
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE' || v.getUint32(4, true) + 8 !== buffer.byteLength) throw fail();
  let format = 0, bits = 0, channels = 0, sampleRate = 0, alignment = 0, data = -1, size = 0;
  for (let at = 12; at + 8 <= buffer.byteLength;) {
    const id = str(at, 4), length = v.getUint32(at + 4, true), start = at + 8;
    if (start + length > buffer.byteLength) throw fail();
    if (id === 'fmt ') {
      if (length < 16) throw fail();
      format = v.getUint16(start, true); channels = v.getUint16(start + 2, true); sampleRate = v.getUint32(start + 4, true);
      alignment = v.getUint16(start + 12, true); bits = v.getUint16(start + 14, true);
    }
    if (id === 'data') { data = start; size = length; }
    at = start + length + (length % 2);
  }
  if (channels !== 1 || data < 0 || !size || sampleRate < 8000 || sampleRate > 96000 || !((format === 1 && bits === 16) || (format === 3 && bits === 32)) || alignment !== bits / 8 || size % alignment) throw fail();
  const pcm = new Float32Array(size / alignment);
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = format === 1 ? v.getInt16(data + i * 2, true) / 32768 : v.getFloat32(data + i * 4, true);
    if (!Number.isFinite(pcm[i]) || Math.abs(pcm[i]) > 1) throw fail();
  }
  return { pcm, sampleRate };
}
