# Operating modes and measurements

The operating mode belongs to the sender of a content transfer. The peer automatically answers acoustic pacing requests. Both endpoints keep Audible Fast for DATA, negotiation, ACK, FIN and recovery. Calibration and legacy text keep the original timing. Balanced is the default.

| Sender selection | Behavior on the wire | Overhead with successful first attempts |
| --- | --- | --- |
| Fixed Balanced | 500 ms before DATA and its ACK. Four total DATA attempts at most. | Existing framing and guards. No extra negotiation. |
| Fixed Robust | Agree to Robust before the first DATA. 900 ms before each DATA and its ACK. Six total DATA attempts at most. | Two 21-byte acoustic control packets and their 500 ms guards per switch. Adds 800 ms per acknowledged chunk. |
| Adaptive | Begin Balanced on a new controller. Request Robust on the loss conditions below. Request Balanced after sustained recovery. Each new transfer starts with baseline HELLO/CAPS and confirms any desired Robust pacing again. | Cost depends on the actual switches, DATA attempts and time in Robust. |

On all three modes, DATA carries the same negotiated number of bytes. Every retry waits for the preceding ACK timeout. Each extra attempt repeats one packet and solicits its ACK. No mode transmits unconditional duplicate copies. Timeout starts after the waveform ends and is 12 seconds. Retry backoff is uniform from 1 to 2 times the exponential base (1, 2, 4, then 8 seconds capped). Control packets use the original 500 ms guard and four-attempt exchange budget, except for SET_POLICY, which has a two-attempt budget. CANCEL is best effort. The pre-send estimate includes a single required Robust switch and extra guards when starting Robust. Further switches, retries and backoffs depend on the exchange.

## Decision evidence

The sender keeps the last eight resolved content DATA attempts. ACK success and timeout counts share this denominator. The retry rate divides attempts numbered two or higher by the same count. Aborted or locally failed playback has no resolved ACK outcome. Only an identity- and sequence-matched ACK advances the sender. A timeout cannot distinguish loss on the forward path from loss on the reply path.

Adaptive requests Robust after two consecutive timeouts, even within the normal dwell period. After at least 10 seconds in Balanced, either two timeouts among the latest four resolved attempts or a timeout accompanied by a locally rejected modem output also triggers fallback. An unrelated malformed packet alone cannot cause a switch. Recovery needs at least 30 seconds in Robust and eight consecutive first-attempt DATA ACKs with no rejected modem output during those attempts. Mode selection and failed negotiation start a fresh decision window. The controller records requested changes, evidence and peer confirmations in a bounded 20-entry log. A new audio transport gets fresh state. Each local simulation starts a new virtual clock and controller.

Decoder counts cover the last 16 nonempty ggwave outputs at this endpoint. Each is counted once as either a valid packet envelope or a rejected envelope (e.g. CRC, shape or version failure). Valid stale packets can count as decodes and still be ignored by transport. Silence and incomplete PCM windows produce empty results. The binding does not distinguish those from an undecodable signal. The controller therefore uses observed ACK outcomes for link loss. No SNR or calibrated quality score is available. Microphone RMS and clipping remain input diagnostics.

Confirmed content goodput is the sum of unique file/text bytes in transfers with a matching FIN_ACK divided by the sum of transfer durations over the latest four finished content sends. A failed or cancelled send with an active controller contributes its elapsed time and zero confirmed bytes. Time includes negotiation, playback, guards, retries and terminal cleanup. Simulation uses waveform duration on its virtual clock. Goodput is reported as an outcome. Short transfers and changing metadata overhead make it an unreliable standalone switch trigger.

## Acoustic agreement and recovery

Each newly accepted content HELLO starts the receiver in Balanced. SET_POLICY (type 11) and POLICY_ACK (12) each carry one byte, 0 for Balanced or 1 for Robust. The sequence is the DATA sequence about to be sent or retried. The sender requires the same version, session, transfer, sequence, response kind and policy byte. While agreement is pending it sends no dependent DATA. Receivers accept requests only for an active content transfer at the next DATA sequence or its just-stored predecessor (lost DATA ACK). They reject older policy generations and conflicting values at the same sequence. Duplicate requests repeat the acoustic confirmation. All control replies use baseline pacing.

A receiver may have applied its ACK delay when the confirmation is lost. Its decoder remains on baseline throughout. After two unanswered attempts the sender terminates unconfirmed, attempts baseline CANCEL and discards this transfer. Adaptive returns to a Balanced target for the next send. A new identity and HELLO/CAPS restore baseline agreement. If CANCEL is also lost, the partial receiver state expires on its 120-second inactivity timer. Older peers can use fixed Balanced. A peer lacking SET_POLICY support cannot confirm a requested switch.

## Installed modem probe

Run `node scripts/inspect-modem.mjs` against pinned npm ggwave 0.4.0. The probe passes six binary bytes through independent fresh encoder and decoder instances, default variable-length receive settings, F32 at 48 kHz and volume 25. It flushes silence after each waveform.

| Exported family | Normal | Fast | Fastest |
| --- | --- | --- | --- |
| Audible | 1.643 s, matched | 1.323 s, matched | 1.003 s, matched |
| Ultrasound | 1.643 s, matched | 1.323 s, matched | 1.003 s, matched |
| DT | 3.179 s, no match | 2.347 s, no match | 1.515 s, matched |

The package also exports ten custom enum slots. The pinned binding exposes no custom frequency setter or MT enums. Protocol ID and modem volume are arguments to each encode. RX/TX protocol toggles take a protocol and state with no instance argument. Sample rates, formats, samples per frame, marker threshold, payload length and operating bits are initialization parameters. A clean six-byte decode does not validate live receiver reconfiguration, echo recovery, full frames or phone speaker frequency response. Physical modem profile switching remains pending. [Upstream JavaScript binding](https://github.com/ggerganov/ggwave/blob/master/bindings/javascript/emscripten.cpp)

## Reproducible comparison

Run `npx vitest run tests/adaptive-pcm.test.ts --reporter=verbose`. Each cell is one fresh deterministic trial with the same 1600-byte file, name, IDs and seeded retry jitter. Both directions use actual ggwave encode/decode. Tests mute samples in specified time intervals before passing PCM into the peer modem. Elapsed time is virtual transfer time through FIN_ACK or terminal failure, including the final best-effort CANCEL. The four conditions are fixed independently of mode and packet type.

| Channel and imposed loss | Balanced | Robust | Adaptive |
| --- | --- | --- | --- |
| Clean both ways | 183.3 s · 8.73 B/s | 199.6 s · 8.01 B/s | 183.3 s · 8.73 B/s |
| Both paths silent from 45 s onward | Failed at 146.0 s | Failed at 209.5 s | Failed at 125.9 s |
| Both paths silent from 35 s to 90 s | Failed at 133.6 s | 278.9 s · 5.74 B/s | Failed at 113.6 s |
| Reply path silent for 12 s every 35 s starting at 20 s | 508.6 s · 3.15 B/s | 579.7 s · 2.76 B/s | 579.2 s · 2.76 B/s |

Unconfirmed cells yielded zero confirmed B/s. Delivery counts were 2/4 Balanced, 3/4 Robust and 2/4 Adaptive. Adaptive tied Balanced on the clean channel, incurred overhead on the asymmetric channel and exhausted its switch negotiation during the temporary outage. These are scripted examples with one timing alignment each. They provide no hardware delivery probability or calibrated quality estimate. The independent transport fault tests also exercise successful fallback and cautious return to Balanced, including a switch after the receiver already stored DATA whose ACK was lost.

For paired **equal-budget** results with a sample-domain noise burst and asymmetric return path, see [the PCM evaluation and complete trial ledger](BENCHMARKS.md).
