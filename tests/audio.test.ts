import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { captureConstraints, processingReport, signalDescription } from '../src/audio-diagnostics';
it('requests processing off only where supported, and distinguishes ignored vs undisclosed settings', () => {
  expect(captureConstraints({ echoCancellation: true, autoGainControl: true, deviceId: true }, 'mic')).toEqual({ channelCount: { ideal: 1 }, echoCancellation: { ideal: false }, autoGainControl: { ideal: false }, deviceId: { exact: 'mic' } });
  const report = processingReport({ echoCancellation: true, noiseSuppression: true }, { echoCancellation: true });
  expect(report[0]).toContain('request ignored'); expect(report[1]).toContain('does not disclose'); expect(report[2]).toContain('unsupported');
  expect(processingReport({ echoCancellation: true }, { echoCancellation: false })[0]).toContain('reports off');
});
it('reports silence, clipping and bounded capture overflow honestly', () => {
  const signal = { rms: 0, peak: 0, clipped: 0, silenceSeconds: 4, droppedSamples: 0, sampleRate: 48000 };
  expect(signalDescription(signal)).toContain('Near silence');
  expect(signalDescription({ ...signal, clipped: 1 })).toContain('Clipping');
  expect(signalDescription({ ...signal, droppedSamples: 4096 })).toContain('overflow');
});
function worklet(rate = 48000) {
  let Processor: any;
  const messages: any[] = [];
  const context = vm.createContext({
    sampleRate: rate, currentTime: 0, Float32Array,
    AudioWorkletProcessor: class { port = { onmessage: undefined, postMessage: (message: unknown) => messages.push(message) }; },
    registerProcessor: (_name: string, cls: unknown) => { Processor = cls; },
  });
  vm.runInContext(readFileSync('public/capture-worklet.js', 'utf8'), context);
  const instance = new Processor();
  const feed = (left: number, right = left, quanta = 32) => {
    for (let i = 0; i < quanta; i++) { context.currentTime += 128 / rate; instance.process([[new Float32Array(128).fill(left), new Float32Array(128).fill(right)]]); }
  };
  return { messages, instance, feed };
}
it('worklet downmixes, measures RMS/peak/clipping outside React and recycles a bounded eight-buffer pool', () => {
  const w = worklet(); w.feed(0.6, -0.2);
  expect(w.messages[0].pcm.length).toBe(4096); expect(w.messages[0].pcm[0]).toBeCloseTo(0.2);
  w.feed(1, 1, 100);
  expect(w.messages.find(m => m.stats)?.stats.clipped).toBeGreaterThan(0);
  w.feed(0, 0, 500);
  expect(w.messages.filter(m => m.pcm)).toHaveLength(8);
  const stats = w.messages.filter(m => m.stats).at(-1).stats;
  expect(stats.silenceSeconds).toBeGreaterThan(1); expect(stats.droppedSamples).toBeGreaterThan(0);
  expect(stats.clipped).toBeGreaterThan(0); // Latched until capture restarts.
  const pcm = w.messages[0].pcm;
  w.instance.port.onmessage({ data: { recycle: pcm } }); w.feed(0, 0);
  expect(w.messages.filter(m => m.pcm)).toHaveLength(9);
});
it('worklet reports its actual 44.1 kHz graph rate and near silence', () => {
  const w = worklet(44100); w.feed(0, 0, 1200);
  const stats = w.messages.filter(m => m.stats).at(-1).stats;
  expect(stats.sampleRate).toBe(44100); expect(stats.rms).toBe(0); expect(stats.silenceSeconds).toBeGreaterThan(3);
});
it('worker ES module is the exact pinned runtime plus its explicit export', () => {
  expect(readFileSync('public/vendor/ggwave-module.mjs', 'utf8')).toBe(readFileSync('public/vendor/ggwave.js', 'utf8') + '\nexport default ggwave_factory;\n');
});
