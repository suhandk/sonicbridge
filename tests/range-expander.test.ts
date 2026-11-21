import { expect, it } from 'vitest';
import { speakerTestTone } from '../src/range-expander';

it.each([44100, 48000])('generates a short, restrained speaker check at %i Hz', rate => {
  const pcm = speakerTestTone(rate);
  expect(pcm).toHaveLength(Math.round(rate * .24));
  expect(pcm[0]).toBe(0);
  expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(.001);
  let peak = 0;
  for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  expect(peak).toBeGreaterThan(.35);
  expect(peak).toBeLessThan(.401);
});
