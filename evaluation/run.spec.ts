import { it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { VirtualClock } from '../src/clock';
import { packContent } from '../src/content';
import type { OperatingMode } from '../src/controller';
import { createModem, type ModemFactory } from '../src/modem';
import { StopAndWait } from '../src/transport';
import { AudioPath, noise, seeds, traces, type Trace } from './channel';
import { report, type Row } from './report';

const factory = createRequire(import.meta.url)('ggwave') as ModemFactory;
const payload = Uint8Array.from({length:480}, (_,i) => Math.floor((noise(i,2026)+1)*128));
const body = packContent('file','trial.bin',payload);
const modes: OperatingMode[] = ['Balanced','Robust','Adaptive'];
const deadlineMs = 120000;
async function trial(trace: Trace, seed: number, mode: OperatingMode): Promise<Row> {
  const clock = new VirtualClock(seed);
  const a = new AudioPath(await createModem(48000,factory),clock,seed,false,trace);
  const b = new AudioPath(await createModem(44100,factory),clock,seed,true,trace);
  a.peer=b; b.peer=a;
  let retries=0, verified=0, copies=0, id=40, expired=false;
  let receivedBytes: Uint8Array | undefined;
  const changes: string[] = [];
  const sender = new StopAndWait(a,clock,{
    packet(e) {
      if (e.direction === 'submit' && (e.attempt ?? 1)>1) {
        if (retries === 6) throw new Error('Shared six-retransmission budget exhausted');
        retries++;
      }
    },
    policy(policy) { changes.push(policy); },
  }, () => ++id, {dataAttemptCap:4});
  const receiver = new StopAndWait(b,clock,{content(file) {
    receivedBytes=file.bytes.slice(); verified=file.bytes.length; copies++;
  }});
  const timer = new AbortController();
  try {
    sender.controller.select(mode);
    void clock.sleep(deadlineMs,timer.signal).then(() => { expired=true; sender.dispose(); receiver.dispose(); }, () => {});
    let outcome: Row['outcome']='complete', reason='';
    try { await clock.drive(sender.send(body,{content:true})); }
    catch (error) {
      reason=String(error);
      if (expired) { outcome='deadline'; reason='120 s trial deadline'; }
      else if (reason.includes('timed out after') || reason.includes('six-retransmission budget')) outcome='failed';
      else throw error;
    }
    expect(copies).toBeLessThanOrEqual(1);
    if (copies) expect(receivedBytes).toEqual(payload);
    if (outcome==='complete') expect(verified).toBe(payload.length);
    expect(clock.now()).toBeLessThanOrEqual(deadlineMs);
    return { trace,seed,mode,outcome,elapsedMs:clock.now(),verified,confirmed:outcome==='complete'?verified:0,retries,changes,reason };
  } finally { timer.abort(); sender.dispose(); receiver.dispose(); a.dispose(); b.dispose(); }
}
it('records all paired trials through the pinned WASM modem', async () => {
  const rows:Row[]=[];
  for (const trace of traces) for (const seed of seeds) for (const mode of modes) rows.push(await trial(trace,seed,mode));
  const payloadHash=createHash('sha256').update(payload).digest('hex');
  writeFileSync('evaluation/results.json', JSON.stringify({kind:'simulated PCM',payloadHash,deadlineMs,rows},null,2)+'\n');
  writeFileSync('BENCHMARKS.md',report(rows,payloadHash,deadlineMs,modes));
});
