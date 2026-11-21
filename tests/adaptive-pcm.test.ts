import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { VirtualClock } from '../src/clock';
import { packContent } from '../src/content';
import type { OperatingMode } from '../src/controller';
import { createModem, type ModemFactory } from '../src/modem';
import { PcmChannel } from '../src/simulation';
import { StopAndWait } from '../src/transport';

const factory = createRequire(import.meta.url)('ggwave') as ModemFactory;
const modes: OperatingMode[] = ['Balanced', 'Robust', 'Adaptive'];
const scenarios = ['stable', 'worsening', 'recovering', 'asymmetric'] as const;
type Scenario = typeof scenarios[number];

// Predefined time-domain erasures independent of packet type, policy, sequence and outcome.
function silent(scenario: Scenario, reverse: boolean, seconds: number) {
  switch (scenario) {
    case 'stable': return false;
    case 'worsening': return seconds >= 45;
    case 'recovering': return seconds >= 35 && seconds < 90;
    case 'asymmetric': return reverse && seconds >= 20 && (seconds - 20) % 35 < 12;
  }
}
for (const scenario of scenarios) {
  it(`measures fixed and adaptive pacing over actual PCM on the ${scenario} channel`, async () => {
    for (const mode of modes) {
      const clock = new VirtualClock(41);
      const make = async (reverse: boolean) => new PcmChannel(await createModem(48000, factory), clock, (pcm, rate) => {
        const start = clock.now()/1000;
        for (let i = 0; i < pcm.length; i++) if (silent(scenario, reverse, start + i/rate)) pcm[i] = 0;
      });
      const a = await make(false), b = await make(true); a.peer = b; b.peer = a;
      const bytes = Uint8Array.from({ length: 1600 }, (_, i) => (31*i + 7) & 255);
      const delivered: Uint8Array[] = [];
      let id = 40;
      const sender = new StopAndWait(a, clock, {}, () => ++id);
      const receiver = new StopAndWait(b, clock, { content: item => delivered.push(item.bytes) });
      try {
        sender.controller.select(mode);
        let confirmed = false;
        try { await clock.drive(sender.send(packContent('file', 'trial.bin', bytes), { content: true })); confirmed = true; }
        catch (error) { expect(String(error)).toMatch(/timed out after/); }
        if (scenario === 'stable') expect(confirmed).toBe(true);
        expect(delivered).toEqual(confirmed ? [bytes] : []);
        const result = sender.controller.snapshot();
        expect(result.confirmedBps).toBeCloseTo((confirmed ? bytes.length : 0) * 1000 / clock.now());
        console.info(`PCM trial | ${scenario} | ${mode} | ${Number(confirmed)} | ${(clock.now()/1000).toFixed(1)} s | ${result.confirmedBps?.toFixed(2)} B/s | ${result.history.filter(s => s.includes('Peer confirmed')).length} switches`);
      } finally { sender.dispose(); receiver.dispose(); a.dispose(); b.dispose(); }
    }
  }, 120000);
}
