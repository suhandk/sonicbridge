# SONICBRIDGE evaluation

**Simulated PCM throughout. Physical trials completed: 0.** Four paired seeds per condition. Each transfer runs the real ggwave 0.4.0 WASM encoder and decoder in both directions, the production packet codec, stop-and-wait controller and SHA-256 verification.

## Reproduce

From the project root with Node 24 and npm, run:

```powershell
npm ci
npm run benchmark
```

The command regenerates this report and [every trial in JSON](evaluation/results.json). It requires no microphone, network or browser after dependency installation. The evaluation is outside the app bundle. The [sample transform](evaluation/channel.ts) and [trial runner](evaluation/run.spec.ts) define the experiment. Unexpected harness errors fail the command.

## Paired design

Each mode sends the same 480 binary bytes as trial.bin. Payload SHA-256 is `0cd9015b9705acd678fac1295241ea9230995d11b1f68726afb97510a0c89ae2`. Both endpoints start fresh for each trial. Seeds 41, 73, 109 and 151 set retry jitter, fixed directional gains, delays, echoes, clock drift and counter-based sample noise. The noise at a given absolute receiver sample is identical for all three modes. A slower policy encounters later parts of the same trace.

Forward playback is 48000 Hz and capture is nominally 44100 Hz. The reverse path swaps those rates. Linear interpolation renders the waveform at the capture rate with up to ±100 ppm offset. Direct gain is 0.32–0.68 and propagation delay is 9–23 ms. Two finite echoes at 9 and 27 ms have signed coefficients of 0.12–0.24 and −0.12 to −0.06 relative to the direct path. Add seeded uniform noise in normalized PCM and clamp to [−1,1]. Parameters are synthetic. They do not encode physical distance or measured room acoustics.

| Trace | Sample-domain change |
| --- | --- |
| quiet | Add noise with peak amplitude 0.008 on both paths. |
| noise burst | Same background, raised to 0.75 from virtual time 18 s through just before 56 s in both directions. |
| weak return | Forward path as quiet. Reverse direct and echo gains multiplied by 0.13, noise peak 0.13. |

Generators operate on PCM during each emitted waveform, propagation delay and a bounded echo/350 ms decoder tail. Playback and receiver notification use separate virtual times. Detection is reported at window end. Idle periods outside capture windows, hardware AGC, environmental recordings and speaker frequency response are unmodeled. Virtual elapsed time excludes offline CPU cost.

Every trial has the same 120 s hard deadline and six total sender retransmissions across all requests. DATA permits four total attempts per sequence for all modes. HELLO/FIN allow four and SET_POLICY two. Guards, deadlines per ACK, backoff, packet size and physical modem are otherwise production settings. Robust and Adaptive retain their negotiated longer guards. The experiment uses four DATA attempts across all modes. Earlier native-budget examples in ADAPTIVE.md answer a different question.

## Results · simulated PCM

Success requires verified receiver reconstruction and matching FIN_ACK at the sender. **OK** is complete/attempted. **Success s** is mean completion time for successes only. **Penalized s** charges every incomplete trial the full 120 s, including early failures. **RX / TX B/s** divides unique receiver-verified / sender-confirmed payload bytes by total observed elapsed time over all trials, including failures and cleanup. Repeated chunks add no bytes. **Retry / switch** totals actual extra sender requests / peer-confirmed pacing changes, including initial negotiation into Robust. **Range** gives minimum–maximum per-trial confirmed B/s across the four seeds, including zeros.

| Trace | Mode | OK | Success s | Penalized s | RX / TX B/s | Retry / switch | Range B/s |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| quiet | Balanced | 4/4 (100%) | 75.2 | 75.2 | 6.38 / 6.38 | 0 / 0 | 6.38–6.39 |
| quiet | Robust | 4/4 (100%) | 85.1 | 85.1 | 5.64 / 5.64 | 0 / 4 | 5.64–5.64 |
| quiet | Adaptive | 4/4 (100%) | 75.2 | 75.2 | 6.38 / 6.38 | 0 / 0 | 6.38–6.39 |
| noise burst | Balanced | 0/4 (0%) | — | 120.0 | 0.00 / 0.00 | 9 / 0 | 0.00–0.00 |
| noise burst | Robust | 0/4 (0%) | — | 120.0 | 0.00 / 0.00 | 12 / 4 | 0.00–0.00 |
| noise burst | Adaptive | 0/4 (0%) | — | 120.0 | 0.00 / 0.00 | 9 / 4 | 0.00–0.00 |
| weak return | Balanced | 0/4 (0%) | — | 120.0 | 0.00 / 0.00 | 12 / 0 | 0.00–0.00 |
| weak return | Robust | 0/4 (0%) | — | 120.0 | 0.00 / 0.00 | 12 / 0 | 0.00–0.00 |
| weak return | Adaptive | 0/4 (0%) | — | 120.0 | 0.00 / 0.00 | 12 / 0 | 0.00–0.00 |

These ranges describe the tested seeds only. Four paired seeds per scenario do not estimate population success probability, hardware compatibility or range. An advantage in one trace does not establish a general winner.

**BER omitted.** ggwave exposes decoded byte messages after synchronization and error correction. Empty decoder output provides no aligned bit decisions. SHA-256 and exact payload comparison establish complete reconstruction; missing packets cannot supply a defensible raw BER denominator.

## Trial ledger · simulated PCM

| Trace | Seed | Mode | Outcome | Elapsed s | RX / TX bytes | Retries | Confirmed switches | Terminal reason |
| --- | ---: | --- | --- | ---: | ---: | ---: | --- | --- |
| quiet | 41 | Balanced | complete | 75.18 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 41 | Robust | complete | 85.15 | 480 / 480 | 0 | Robust | FIN_ACK |
| quiet | 41 | Adaptive | complete | 75.18 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 73 | Balanced | complete | 75.14 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 73 | Robust | complete | 85.10 | 480 / 480 | 0 | Robust | FIN_ACK |
| quiet | 73 | Adaptive | complete | 75.14 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 109 | Balanced | complete | 75.19 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 109 | Robust | complete | 85.16 | 480 / 480 | 0 | Robust | FIN_ACK |
| quiet | 109 | Adaptive | complete | 75.19 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 151 | Balanced | complete | 75.21 | 480 / 480 | 0 | — | FIN_ACK |
| quiet | 151 | Robust | complete | 85.18 | 480 / 480 | 0 | Robust | FIN_ACK |
| quiet | 151 | Adaptive | complete | 75.21 | 480 / 480 | 0 | — | FIN_ACK |
| noise burst | 41 | Balanced | deadline | 120.00 | 0 / 0 | 2 | — | 120 s trial deadline |
| noise burst | 41 | Robust | deadline | 120.00 | 0 / 0 | 3 | Robust | 120 s trial deadline |
| noise burst | 41 | Adaptive | deadline | 120.00 | 0 / 0 | 2 | Robust | 120 s trial deadline |
| noise burst | 73 | Balanced | deadline | 120.00 | 0 / 0 | 2 | — | 120 s trial deadline |
| noise burst | 73 | Robust | deadline | 120.00 | 0 / 0 | 3 | Robust | 120 s trial deadline |
| noise burst | 73 | Adaptive | deadline | 120.00 | 0 / 0 | 2 | Robust | 120 s trial deadline |
| noise burst | 109 | Balanced | deadline | 120.00 | 0 / 0 | 3 | — | 120 s trial deadline |
| noise burst | 109 | Robust | deadline | 120.00 | 0 / 0 | 3 | Robust | 120 s trial deadline |
| noise burst | 109 | Adaptive | deadline | 120.00 | 0 / 0 | 3 | Robust | 120 s trial deadline |
| noise burst | 151 | Balanced | deadline | 120.00 | 0 / 0 | 2 | — | 120 s trial deadline |
| noise burst | 151 | Robust | deadline | 120.00 | 0 / 0 | 3 | Robust | 120 s trial deadline |
| noise burst | 151 | Adaptive | deadline | 120.00 | 0 / 0 | 2 | Robust | 120 s trial deadline |
| weak return | 41 | Balanced | failed | 77.35 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 41 | Robust | failed | 77.35 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 41 | Adaptive | failed | 77.35 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 73 | Balanced | failed | 76.81 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 73 | Robust | failed | 76.81 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 73 | Adaptive | failed | 76.81 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 109 | Balanced | failed | 73.96 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 109 | Robust | failed | 73.96 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 109 | Adaptive | failed | 73.96 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 151 | Balanced | failed | 74.62 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 151 | Robust | failed | 74.62 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |
| weak return | 151 | Adaptive | failed | 74.62 | 0 / 0 | 3 | — | Error: CONTENT_CAPS timed out after 4 attempts. Delivery unconfirmed; receiver may have completed. |

Protocol-only packet loss, stale ACK and corruption checks run separately with `npx vitest run tests/transport.test.ts`. Their results are excluded above. For hardware evidence use the [physical trial sheet](PHYSICAL_TEST_SHEET.md).
