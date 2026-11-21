import { expect, it } from 'vitest';
import { capture, path } from '../evaluation/channel';

it('indexes capture noise by absolute receiver sample across overlapping windows', () => {
  const silence = new Float32Array(960);
  const render = (ms: number, seed: number) => capture(silence, 48000, 44100, ms, seed, false, 'quiet').pcm;
  const rate = 44100 * (1 + path(41, false).ppm / 1e6);
  const offset = Math.ceil(0.010 * rate);
  expect(render(0, 41).slice(offset, offset + 128)).toEqual(render(10, 41).slice(0, 128));
  expect(render(0, 41).slice(0, 128)).not.toEqual(render(0, 73).slice(0, 128));
});

it('renders propagation delay, both echoes and their finite tail across sample rates', () => {
  const input = new Float32Array(4800);
  input.fill(1, 0, 240);
  const p = path(73, false);
  const { pcm } = capture(input, 48000, 44100, 0, 73, false, 'quiet');
  const sample = (ms: number) => pcm[Math.round(ms * 44.1 * (1 + p.ppm / 1e6))];
  for (const [offset, coefficient] of [[-1, 0], [2, 1], [11, p.echo1], [29, p.echo2], [35, 0]]) {
    expect(Math.abs(sample(p.delayMs + offset) - p.gain * coefficient)).toBeLessThan(0.0081);
  }
  expect(() => capture(input, 32000, 44100, 0, 73, false, 'quiet')).toThrow();
});
