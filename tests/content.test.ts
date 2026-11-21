import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { estimateTransfer, packContent, safeName, verifyContent } from '../src/content';
import { inspectRaster } from '../src/images';

it('matches independent SHA-256 for empty files and arbitrary binary content', () => {
  for (const size of [0, 1, 4000]) {
    const bytes = crypto.getRandomValues(new Uint8Array(size)), body = packContent('file', '音.bin', bytes);
    expect(Buffer.from(body.subarray(5, 37))).toEqual(createHash('sha256').update(bytes).digest());
    expect(verifyContent(body).bytes).toEqual(bytes);
  }
});
it('bounds encoded filenames and rejects truncated, exaggerated or unsafe manifests', () => {
  const name = safeName('../NUL:music' + '橋'.repeat(50));
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(64);
  expect(name).not.toMatch(/[/:]/);
  expect(safeName('CON.txt')).toBe('_CON.txt');
  const body = packContent('file', 'A', new Uint8Array(0));
  for (const [offset, value] of [[0, 2], [1, 7], [2, 255], [3, 1], [4, 65], [37, 47], [37, 255]]) {
    const corrupt = body.slice(); corrupt[offset] = value;
    expect(() => verifyContent(corrupt)).toThrow();
  }
  expect(() => verifyContent(body.subarray(0, 36))).toThrow();
  expect(() => packContent('file', 'A', new Uint8Array(4096))).toThrow();
  expect(() => verifyContent(packContent('text', 'A', Uint8Array.of(255)))).toThrow();
});
it('accounts for all framed control and data bytes in estimates', () => {
  const estimate = estimateTransfer(121);
  expect(estimate.wireBytes).toBe(121 + 8 * 20 + 38);
  expect(estimate.count).toBe(2);
  expect(estimate.seconds).toBeGreaterThan(estimate.wireBytes * 8 / 187.5);
});
it('Turbo fastest mode significantly reduces transfer airtime estimate', () => {
  const standard = estimateTransfer(500, undefined, false, false);
  const turbo = estimateTransfer(500, undefined, false, true);
  expect(turbo.seconds).toBeLessThan(standard.seconds * 0.65);
});
it('refuses HTML, SVG, truncated and oversized raster headers', () => {
  for (const text of ['<html>', '<svg/>']) expect(() => inspectRaster(new TextEncoder().encode(text), 512 ** 2)).toThrow();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452ffffffffffffffff000000000000000000','hex');
  expect(() => inspectRaster(png, 512 ** 2)).toThrow('dimensions');
  expect(() => inspectRaster(png.subarray(0, 12), 512 ** 2)).toThrow();
});
