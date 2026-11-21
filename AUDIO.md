# Real-time audio path

## Activation and interruption policy

Start Audio / Resume Audio is the only path calling AudioContext.resume(), synchronously within an explicit click before awaiting DSP initialization. Protocol callbacks, Listen and Send do not silently resume a stopped context. Contexts use the actual native graph sample rate with interactive latency preference, not an assumed microphone rate.

The app stops and releases audio on detectable context suspension/interruption, page hiding/freezing, device-change/sink-change events, microphone end/mute, capture stall (3 seconds without PCM), or buffer overflow. Transfer and calibration state are disposed/cancelled; returning to the foreground never resumes them automatically. The user must Start Audio, listen and recalibrate. Background/lock OS behavior differs by browser, and some routes are not disclosed; hardware behavior is still untested. Keeping the screen awake is the user's responsibility; there is no wake-lock/background-transfer promise.

Stop Audio disconnects source/worklet/gain nodes, closes ports/context, stops tracks, terminates the DSP worker, clears timers/listeners and cancels pending RPC. A generation token prevents late microphone permission/worklet initialization from reviving stopped audio; late streams are stopped immediately. Stop listening ends capture/transport but may leave the explicitly started, idle AudioContext/worker available until Stop Audio.

## Threads and bounded buffering

```text
Mic track (effective settings)
  → browser MediaStreamSource resampling to AudioContext rate
  → AudioWorklet: mono downmix + levels, 4096-sample recycled buffers
  → transferable PCM via main-thread routing (no demodulation in React)
  → dedicated module Worker: actual ggwave WASM encode/decode/reset
  → copied binary packet → transport validation/reassembly → React receipt

Transmit packet → worker encode → owned PCM → GainNode → speaker
```

The worklet preallocates eight 4096-float buffers, ~128 KiB of PCM. Buffers transfer to the worker and recycle back to the worklet. Per-quantum owned buffers are not allocated. When the pool is exhausted, dropped samples are counted explicitly and the app stops the stream instead of accumulating stale audio or silently claiming reliable reception. The worker RPC map is capped at 12 requests and each has a 10-second failure timeout. Transport playback has its separate 30-second watchdog.

RMS, peak, clipping, near-silence duration and dropped samples are calculated in the worklet. UI telemetry is about four updates/second. Clipping uses absolute sample ≥0.98 and is latched until capture restarts. Near-silence counts consecutive samples below absolute 0.001; 3 seconds triggers a diagnostic hint. These values indicate input level only, not tone detection, SNR, distance or delivery. Room noise may prevent a silence warning even when there is no acoustic packet. Packet/body CRC and verified completion remain the delivery criterion.

Real-time demodulation and encoding are outside the main UI/render thread. WAV import and accelerated ideal PCM simulation are explicitly non-real-time debugging utilities; their existing bounded synchronous decoding remains on the main thread.

## Rates and resampling

MediaStreamTrack.getSettings().sampleRate is reported when provided; otherwise UI says not reported. Web Audio converts track audio into the AudioContext graph rate, and the worklet's sampleRate confirms that actual PCM rate. The worker initializes ggwave with that rate for input/output while ggwave's internal analysis rate remains its default 48 kHz. Thus a 44.1 kHz graph uses ggwave's tested resampler. We do not reinterpret 44.1 kHz floats as 48 kHz or independently resample twice at the capture boundary.

4096-sample calls preserve the existing workaround for ggwave 0.4.0's reproduced small-chunk 44.1 kHz failure. At 44.1 kHz one batch spans ~93 ms; at 48 kHz ~85 ms. Tests cover maximum binary frames at both rates, WAV-fed real worklet/worker reception with both graph rates, and actual OfflineAudioContext conversion 48→44.1 / 44.1→48 kHz followed by modem decoding. These are software tests; clock drift and actual phone hardware rates remain unmeasured.

## Processing, permissions and selection

getSupportedConstraints() gates requests for ideal false echoCancellation, noiseSuppression and autoGainControl; mono is preferred without making unsupported processing flags fatal. After permission, getSettings() is inspected for each flag. Browser-reported true is explicitly shown as a requested-off setting that was ignored; false is reported off; absent or unsupported values stay unknown. Browser reports do not establish whether an OS/device applies additional signal processing.

The input picker uses deviceId exact when supported. An unavailable/overconstrained selected microphone falls back once to default with an explicit diagnostic; permission denial does not trigger a fallback/re-prompt loop. Effective track identity/rate is displayed. Labels and device lists may be hidden until permission; enumeration refresh is available. IDs are not cached or transmitted.

Output uses AudioContext.setSinkId only when available and permitted. Selecting output stops current audio, saves the choice, and requires Start Audio to apply it. Unsupported browsers use OS routing; the app does not pretend that an unsupported picker selected a speaker. Many mobile/Safari configurations require OS controls. Unavailable outputs yield a visible error and can be reset to Browser / OS default. Device/route changes require recalibration. No browser-specific support is inferred from a mobile-looking viewport.

Permission denial, no device, device-in-use/OS privacy failures, missing secure context, unsupported worklets, worker errors and capture interruptions are shown as actual errors. Permission status is queried when exposed, with live-track status retained when the browser lacks the Permissions API query.

## Playback and echo exclusion

The existing ggwave encode level remains 25; app GainNode defaults to 0.6, about 15% digital full scale. The gain slider is bounded to 0.1–1 and OS speaker volume remains independent. This is a restrained starting level, not a loudness measurement or a promise that every room/device can decode it.

During TX, input batches are recycled without decoding. Partial modem state is reset before encoding/playback and after playback, and timestamped batches overlapping playback or the next 250 ms are excluded. Peers use the existing 500 ms pre-transmission guard and the same audible control baseline. The protocol also rejects local request types during an outgoing session. Echo tails longer than these initial values may still require hardware-driven tuning; no physical result is claimed.

## Calibration and offline setup

Calibration is user-triggered: arm the second device for one response, then calibrate from the first. Both peers exchange nonce-bearing request/reply bodies over complete reliable acoustic transfers. A local tone, successful PCM simulation, or input meter alone never counts as a bidirectional calibration. Metrics/flags are a snapshot/latched diagnostics report, not an estimated SNR or trusted hardware attestation. See PROTOCOL.md for byte layout.

The production PWA precaches all local JS/embedded WASM, module worker, worklet, styles, manifest and icons. First load/install and later acoustic transport are separate. Cache readiness is explicit; storage may be evicted and updates require a stop-and-reload action. Dev mode deliberately does not register a service worker. HTTPS.md and hosting/ provide local trusted-certificate/static-host setup without publishing.

References checked 2026-11-20: [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode), [track constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints), [effective settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings), [context interruptions](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state), [output selection limitations](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId), [service-worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Console monitoring and optional recording

The scope copies a bounded 2048-sample snapshot before microphone PCM is transferred to the decoder. It labels live microphone input, encoded modem output, and accelerated simulation output separately. Waveform columns use min/max samples. The spectrogram uses 64-sample Hann windows and 32 frequency bins. Brightness is clipped to the display range of -80 to 0 dB relative to full scale. The display refreshes at most four times per second, pauses with the plot control, and starts paused with reduced motion enabled. Its time axis covers a single captured snapshot.

**Record 5 s of microphone** allocates five seconds of mono Float32 PCM at the actual graph rate. Capture starts only on that click. **Export microphone WAV** writes a PCM16 file when the clip is complete. Discard, stopping the input, a mode change, or an interruption releases the clip. The app does not write microphone data to localStorage, IndexedDB or the service-worker cache.
