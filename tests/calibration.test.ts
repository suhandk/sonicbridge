import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Calibration, calibrationBody, parseCalibration } from '../src/calibration';
import { VirtualClock } from '../src/clock';
import { createModem, type ModemFactory } from '../src/modem';
import { PcmChannel } from '../src/simulation';
import { StopAndWait } from '../src/transport';
const metrics = { sampleRate: 44100, rms: 0.1, peak: 0.2, flags: 2 };
it('calibration bodies cannot collide with text, validate exact lengths and echo an eight-byte nonce', () => {
  expect(parseCalibration(new TextEncoder().encode('ordinary text'))).toBeUndefined();
  const nonce = new Uint8Array(8).fill(41), body = calibrationBody(nonce, metrics);
  expect(parseCalibration(body)?.nonce).toEqual(nonce); expect(parseCalibration(body)?.metrics?.sampleRate).toBe(44100);
  expect(() => parseCalibration(body.subarray(0, 22))).toThrow();
  const bad = body.slice(); bad[4] = 9; expect(() => parseCalibration(bad)).toThrow();
});
it('unarmed receiver never automatically answers a challenge, and arming permits only one response', async () => {
  let sent = 0;
  const c = new Calibration({ send: async () => { sent++; }, whenIdle: async () => {}, cancel: () => {} }, () => metrics, () => {});
  const body = calibrationBody(new Uint8Array(8));
  c.handle(body); await Promise.resolve(); expect(sent).toBe(0);
  c.arm(); c.handle(body); c.handle(body); await Promise.resolve(); await Promise.resolve(); expect(sent).toBe(1); c.dispose();
});
it('wrong-nonce and stale results cannot satisfy the calibration waiter', async () => {
  const clock = new VirtualClock();
  const c = new Calibration({ send: async () => {}, whenIdle: async () => {}, cancel: () => {} }, () => metrics, () => {}, clock, () => new Uint8Array(8).fill(1));
  const task = c.run(); c.handle(calibrationBody(new Uint8Array(8).fill(2), metrics));
  await expect(clock.drive(task)).rejects.toThrow('timed out'); c.dispose();
});
it('calibration cancellation stops waiting without claiming success', async () => {
  const clock = new VirtualClock(); let cancelled = false;
  const c = new Calibration({ send: async () => {}, whenIdle: async () => {}, cancel: () => { cancelled = true; } }, () => metrics, () => {}, clock);
  const task = c.run(); void task.catch(() => {}); await clock.flush(); c.cancel();
  await expect(clock.drive(task)).rejects.toThrow('cancelled'); expect(cancelled).toBe(true); c.dispose();
});
it('two armed real-codec PCM endpoints complete the bidirectional calibration challenge above the reliable transport', async () => {
  const clock = new VirtualClock(41), factory = createRequire(import.meta.url)('ggwave') as ModemFactory;
  const a = new PcmChannel(await createModem(48000, factory), clock), b = new PcmChannel(await createModem(48000, factory), clock); a.peer = b; b.peer = a;
  let ca: Calibration, cb: Calibration, id = 10;
  const ta = new StopAndWait(a, clock, { deliver: bytes => ca.handle(bytes) }, () => ++id);
  const tb = new StopAndWait(b, clock, { deliver: bytes => cb.handle(bytes) }, () => ++id);
  ca = new Calibration(ta, () => metrics, () => {}, clock); cb = new Calibration(tb, () => metrics, () => {}, clock);
  try { cb.arm(); const result = await clock.drive(ca.run()); expect(result.sampleRate).toBe(44100); expect(result.flags).toBe(2); expect(result.rms).toBeCloseTo(0.1, 4); }
  finally { ca.dispose(); cb.dispose(); ta.dispose(); tb.dispose(); a.dispose(); b.dispose(); }
}, 30000);
