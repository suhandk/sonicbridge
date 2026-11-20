import type { OperatingMode } from '../src/controller';
import { traces, type Trace } from './channel';

export interface Row {
  seed:number; trace:Trace; mode:OperatingMode; outcome:'complete'|'failed'|'deadline';
  elapsedMs:number; verified:number; confirmed:number; retries:number; changes:string[]; reason:string;
}
const sum=(values:number[]) => values.reduce((a,b)=>a+b,0);
export function report(rows:Row[], hash:string, limit:number, modes:OperatingMode[]) {
  const lines = [
    '# SONICBRIDGE evaluation', '',
    '**Simulated PCM throughout. Physical trials completed: 0.** Four paired seeds per condition. Each transfer runs the real ggwave 0.4.0 WASM encoder and decoder in both directions, the production packet codec, stop-and-wait controller and SHA-256 verification.', '',
    '## Reproduce', '', 'From the project root with Node 24 and npm, run:', '',
    '```powershell','npm ci','npm run benchmark','```','',
    'The command regenerates this report and [every trial in JSON](evaluation/results.json). It requires no microphone, network or browser after dependency installation. The evaluation is outside the app bundle. The [sample transform](evaluation/channel.ts) and [trial runner](evaluation/run.spec.ts) define the experiment. Unexpected harness errors fail the command.', '',
    '## Paired design', '',
    'Each mode sends the same 480 binary bytes as trial.bin. Payload SHA-256 is `'+hash+'`. Both endpoints start fresh for each trial. Seeds 41, 73, 109 and 151 set retry jitter, fixed directional gains, delays, echoes, clock drift and counter-based sample noise. The noise at a given absolute receiver sample is identical for all three modes. A slower policy encounters later parts of the same trace.', '',
    'Forward playback is 48000 Hz and capture is nominally 44100 Hz. The reverse path swaps those rates. Linear interpolation renders the waveform at the capture rate with up to ±100 ppm offset. Direct gain is 0.32–0.68 and propagation delay is 9–23 ms. Two finite echoes at 9 and 27 ms have signed coefficients of 0.12–0.24 and −0.12 to −0.06 relative to the direct path. Add seeded uniform noise in normalized PCM and clamp to [−1,1]. Parameters are synthetic. They do not encode physical distance or measured room acoustics.', '',
    '| Trace | Sample-domain change |','| --- | --- |',
    '| quiet | Add noise with peak amplitude 0.008 on both paths. |',
    '| noise burst | Same background, raised to 0.75 from virtual time 18 s through just before 56 s in both directions. |',
    '| weak return | Forward path as quiet. Reverse direct and echo gains multiplied by 0.13, noise peak 0.13. |','',
    'Generators operate on PCM during each emitted waveform, propagation delay and a bounded echo/350 ms decoder tail. Playback and receiver notification use separate virtual times. Detection is reported at window end. Idle periods outside capture windows, hardware AGC, environmental recordings and speaker frequency response are unmodeled. Virtual elapsed time excludes offline CPU cost.', '',
    'Every trial has the same 120 s hard deadline and six total sender retransmissions across all requests. DATA permits four total attempts per sequence for all modes. HELLO/FIN allow four and SET_POLICY two. Guards, deadlines per ACK, backoff, packet size and physical modem are otherwise production settings. Robust and Adaptive retain their negotiated longer guards; the experiment caps their usual six DATA attempts at four. Earlier native-budget examples in ADAPTIVE.md answer a different question.', '',
    '## Results · simulated PCM', '',
    'Success requires verified receiver reconstruction and matching FIN_ACK at the sender. **OK** is complete/attempted. **Success s** is mean completion time for successes only. **Penalized s** charges every incomplete trial the full 120 s, including early failures. **RX / TX B/s** divides unique receiver-verified / sender-confirmed payload bytes by total observed elapsed time over all trials, including failures and cleanup. Repeated chunks add no bytes. **Retry / switch** totals actual extra sender requests / peer-confirmed pacing changes, including initial negotiation into Robust. **Range** gives minimum–maximum per-trial confirmed B/s across the four seeds, including zeros.', '',
    '| Trace | Mode | OK | Success s | Penalized s | RX / TX B/s | Retry / switch | Range B/s |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const trace of traces) for (const mode of modes) {
    const group=rows.filter(r=>r.trace===trace && r.mode===mode), ok=group.filter(r=>r.outcome==='complete');
    const seconds=sum(group.map(r=>r.elapsedMs))/1000, rates=group.map(r=>1000*r.confirmed/r.elapsedMs);
    const latency=ok.length ? (sum(ok.map(r=>r.elapsedMs))/ok.length/1000).toFixed(1) : '—';
    const penalty=sum(group.map(r=>r.outcome==='complete'?r.elapsedMs:limit))/group.length/1000;
    lines.push(`| ${trace} | ${mode} | ${ok.length}/${group.length} (${100*ok.length/group.length}%) | ${latency} | ${penalty.toFixed(1)} | ${(sum(group.map(r=>r.verified))/seconds).toFixed(2)} / ${(sum(group.map(r=>r.confirmed))/seconds).toFixed(2)} | ${sum(group.map(r=>r.retries))} / ${sum(group.map(r=>r.changes.length))} | ${Math.min(...rates).toFixed(2)}–${Math.max(...rates).toFixed(2)} |`);
  }
  lines.push('', 'These ranges describe the tested seeds only. Four paired seeds per scenario do not estimate population success probability, hardware compatibility or range. An advantage in one trace does not establish a general winner.', '',
    '**BER omitted.** ggwave exposes decoded byte messages after synchronization and error correction. Empty decoder output provides no aligned bit decisions. SHA-256 and exact payload comparison establish complete reconstruction; missing packets cannot supply a defensible raw BER denominator.', '',
    '## Trial ledger · simulated PCM', '',
    '| Trace | Seed | Mode | Outcome | Elapsed s | RX / TX bytes | Retries | Confirmed switches | Terminal reason |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- |');
  for (const r of rows) lines.push(`| ${r.trace} | ${r.seed} | ${r.mode} | ${r.outcome} | ${(r.elapsedMs/1000).toFixed(2)} | ${r.verified} / ${r.confirmed} | ${r.retries} | ${r.changes.join(' → ')||'—'} | ${r.reason||'FIN_ACK'} |`);
  lines.push('', 'Protocol-only packet loss, stale ACK and corruption checks run separately with `npx vitest run tests/transport.test.ts`. Their results are excluded above. For hardware evidence use the [physical trial sheet](PHYSICAL_TEST_SHEET.md).', '');
  return lines.join('\n');
}
