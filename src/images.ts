const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
export interface Raster { width: number; height: number; mime: 'image/png' | 'image/jpeg' }
export function inspectRaster(b: Uint8Array, pixelLimit: number): Raster {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  function dimensions(width: number, height: number, mime: Raster['mime']): Raster {
    if (!width || !height || width * height > pixelLimit || Math.max(width, height) > 8192) throw new Error('Image dimensions exceed the preview limit.');
    return { width, height, mime };
  }
  if (b.length >= 33 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a && v.getUint32(8) === 13 && v.getUint32(12) === 0x49484452) {
    const raster = dimensions(v.getUint32(16), v.getUint32(20), 'image/png');
    for (let i = 33; i + 12 <= b.length;) {
      const length = v.getUint32(i), type = v.getUint32(i + 4);
      // Avoid sending compressed ancillary metadata to the browser's image decoder.
      if ([0x69434350, 0x7a545874, 0x69545874].includes(type)) break;
      if (length > b.length - i - 12 || type === 0x6163544c || type === 0x49484452) break;
      i += length + 12;
      if (type === 0x49454e44 && !length && i === b.length) return raster;
    }
  }
  if (b[0] === 255 && b[1] === 216) {
    let raster: Raster | undefined;
    let scan = false;
    for (let i = 2; i < b.length;) {
      // Within entropy-coded data only unescaped marker bytes end a scan.
      if (scan) { while (i < b.length && b[i] !== 255) i++; }
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (scan && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
      if (marker === 0xd9 && scan && raster && i === b.length) return raster;
      scan = false;
      if (i + 2 > b.length) break;
      const size = v.getUint16(i);
      if (size < 2 || size > b.length - i) break;
      if (marker === 0xc0 || marker === 0xc2) {
        if (size < 11 || raster) break;
        raster = dimensions(v.getUint16(i+5), v.getUint16(i+3), 'image/jpeg');
      } else if (marker === 0xda && raster) scan = true;
      else if (![0xc4, 0xdb, 0xdd, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) break;
      i += size;
    }
  }
  throw new Error('Preview supports static PNG and JPEG images with valid dimensions.');
}
export async function readImage(file: File) {
  if (!file.size || file.size > MAX_SOURCE_BYTES) throw new Error('Choose an image up to 6 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const raster = inspectRaster(bytes, 12_000_000);
  return { bytes, raster, name: file.name, thumbnail: false };
}
export type ImageDraft = Awaited<ReturnType<typeof readImage>>;
export async function thumbnail(source: ImageDraft): Promise<ImageDraft> {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(source.bytes)], { type: source.raster.mime }));
  const canvas = document.createElement('canvas');
  try {
    let best: ImageDraft | undefined;
    const miss = (size: number) => Math.max(1024 - size, size - 3072, 0);
    for (const edge of [256, 192, 144, 96, 64, 32]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Local image resizing unavailable.');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.60, 0.35]) {
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Thumbnail encoding failed.')), 'image/jpeg', quality));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const candidate = { name: source.name.replace(/\.[^.]*$/, '') + '-thumb.jpg', bytes, raster: inspectRaster(bytes, 256 ** 2), thumbnail: true };
        if (!best || miss(bytes.length) < miss(best.bytes.length)) best = candidate;
        if (bytes.length <= 3072) return best;
      }
    }
    return best!;
  } finally { bitmap.close(); canvas.width = canvas.height = 0; }
}
