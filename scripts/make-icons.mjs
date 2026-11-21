import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, body) { const tag = Buffer.from(type), out = Buffer.alloc(12 + body.length); out.writeUInt32BE(body.length); tag.copy(out, 4); body.copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([tag, body])), 8 + body.length); return out; }
await mkdir('public/icons', { recursive: true });
for (const size of [180, 192, 512]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const wave = u > 0.22 && u < 0.78 && [0.36, 0.5, 0.64].some(center => Math.abs(v - center - Math.sin(u * Math.PI * 4) * 0.045) < 0.018);
    const at = y * (size * 3 + 1) + 1 + x * 3;
    raw.set(wave ? [195, 241, 130] : [32, 59, 48], at);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  await writeFile(`public/icons/icon-${size}.png`, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
