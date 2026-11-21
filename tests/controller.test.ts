import { expect, it } from 'vitest';
import { LinkController } from '../src/controller';
import { VirtualClock } from '../src/clock';

it('requires recovery dwell and eight clean observations; reports only bounded measured windows', async () => {
  const clock = new VirtualClock(), controller = new LinkController(clock);
  controller.select('Adaptive'); controller.outcome(false, false, false); controller.outcome(false, true, false);
  for (let i = 0; i < 9; i++) controller.outcome(true, false, false);
  expect(controller.target).toBe('Robust');
  await clock.drive(clock.sleep(30000, new AbortController().signal));
  controller.outcome(true, false, true);
  for (let i = 0; i < 7; i++) controller.outcome(true, false, false);
  expect(controller.target).toBe('Robust');
  controller.outcome(true, false, false); expect(controller.target).toBe('Balanced');
  for (let i = 0; i < 17; i++) controller.decode(i > 1);
  controller.finish(1000, 40000); controller.finish(0, 10000);
  expect(controller.snapshot()).toMatchObject({ acks: 8, attempts: 8, retries: 0, decoded: 15, rejected: 1, confirmedBps: 20 });
});
it('uses a rejected candidate only alongside an ACK timeout and after Balanced dwell', async () => {
  const clock = new VirtualClock(), controller = new LinkController(clock);
  controller.select('Adaptive'); controller.outcome(false, false, true);
  controller.outcome(true, true, false);
  expect(controller.target).toBe('Balanced');
  await clock.drive(clock.sleep(10000, new AbortController().signal));
  for (let i = 0; i < 4; i++) controller.outcome(true, false, true);
  controller.outcome(false, false, true);
  expect(controller.snapshot().history.at(-1)).toContain('rejected modem output');
});
