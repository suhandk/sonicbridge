# Device test matrix

Updated 2026-11-20. **No physical speaker → air → microphone combination has been validated.** Automated Chromium, generated WAV microphone input, worklet unit tests and ideal PCM calibration establish software behavior only. A responsive 390px viewport is not an Android/iPhone test.

| Browser / device | Software checks in this workspace | Physical acoustic transfer + calibration | PWA install/offline on that actual device | Selection / lifecycle notes to test |
| --- | --- | --- | --- | --- |
| Android Chrome, built-in mic/speaker | Not run on Android | **UNTESTED** | **UNTESTED** | Trusted HTTPS/CA, processing settings, route picker, lock/background, Bluetooth removal |
| iPhone Safari, built-in mic/speaker | Not run on iPhone or Safari | **UNTESTED** | **UNTESTED**, including installed Home Screen mode | Explicit activation; interrupted state; full CA trust; output selection may require OS controls; never assume background microphone survives |
| Windows Chromium 159 via Playwright | Automated worklet/worker capture from generated WAV, context/route/background handlers, rates, production/offline reload | **UNTESTED** | Browser offline software reload passes; native installation UI not manually exercised | Fake mic is not the laptop mic. Route/background events partly injected; actual OS interruption/lock remains untested |
| Windows Chrome on physical laptop | Modem is exercised through Chromium automation, not a manual Chrome hardware trial | **UNTESTED** | **UNTESTED** manually | Record actual browser version, permissions, selected/effective devices |
| Windows Edge | Not run as Edge | **UNTESTED** | **UNTESTED** | Sharing a rendering engine does not count as an Edge measurement |
| Firefox desktop | Not run | **UNTESTED** | **UNTESTED**; install UI varies | Check worker/worklet/permissions and output selection rather than assuming support |
| macOS Safari desktop | Not run | **UNTESTED** | **UNTESTED** | Processing disclosure, output controls, permission changes and sleep/wake |

## Rate verification

| Path | Verified |
| --- | --- |
| Actual ggwave max binary packets, native configured PCM 44.1 and 48 kHz | Software PASS |
| Worklet → dedicated modem worker → binary protocol receiver, graph forced to 44.1 and 48 kHz, WAV-fed Chromium mic | Software PASS at both forced graph rates; details in STATUS.md |
| Actual Web Audio OfflineAudioContext resampling 48→44.1 and 44.1→48 kHz, then ggwave decode | Software PASS |
| Real Android/iPhone microphone rate, OS conversion and drift over air | **UNTESTED** |

The effective microphone track rate may differ from the AudioContext/worklet rate. Web Audio converts the track into its graph; the graph rate is what goes to ggwave, which resamples to its internal 48 kHz. An undisclosed track setting is shown as not reported, not guessed.

## Practical physical test procedure

Use HTTPS.md for trust/setup, then repeat every relevant case in **both directions** for Android↔laptop and iPhone↔laptop. Log phone↔phone separately if attempted.

1. Load/install online; wait for Offline app ready; reload with connectivity off. Grant microphone access explicitly and inspect actual settings. Record any ignored or undisclosed echo/noise/AGC constraints, selected/effective input, output route and both reported rates.
2. At 0.5 m, low ambient noise, and moderate OS volume, arm the calibration receiver on B and calibrate from A. Require the fresh challenge reply. Record duration, metrics/flags, retries and failure text. A level meter, tone or sender waveform is not a passing exchange.
3. Send `Hello नमस्ते 🌉`, then a 300-byte UTF-8 body, ten attempts in each direction. Require MICROPHONE / VERIFIED at the receiver and Transfer confirmed after FIN_ACK at the sender. Record successes/attempts and exact text. Increase distance/noise only as a separate measurement.
4. Exercise wrong/default/USB input choice, unavailable-device fallback, muted input, quiet input for 3+ seconds, and clipping with a brief controlled input. Avoid increasing speaker volume aggressively; move devices apart or lower gain when clipping is reported. Stop/restart capture to clear latched clipping.
5. During HELLO, DATA and final acknowledgement, test Cancel transfer, Stop Audio, permission revocation, headphone/Bluetooth connect/disconnect, output-route change, backgrounding, screen lock, OS phone-call interruption and laptop sleep. Expect cancellation/released tracks and a visible Start Audio instruction; no automatic continuation or success claim. Return, explicitly Start Audio/listen, recalibrate and start a fresh transfer.
6. Interrupt an ACK/final acknowledgement and verify retry/FIN replay behavior. Do not count software fault-injection results as physical recovery measurements. Test 10-minute replay-window behavior separately if relevant.

## Blank result record

| Date | A model / OS / browser | B model / OS / browser | Input + graph rates | Effective processing | Route / gain / OS volume | Distance / room | Calibration result / flags | Message successes / attempts | Interruption / retry observations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | — | — | — | — | — | — | — | — | — |

Do not replace UNTESTED with PASS without measured observations. Browser API references describe possible capabilities, not validation of these combinations: [effective settings](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getSettings), [device enumeration](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices), [limited output selection](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/setSinkId), [interrupted contexts](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state).


For the binary-content trial, record the original or thumbnail filename and size, image dimensions, SHA-256 on both devices, elapsed time through FIN_ACK, retry count and application goodput. Repeat with an arbitrary small file and cancel once before FIN. These physical trials are pending.

Physical comparison of Balanced, Robust and Adaptive is pending. For each direction repeat the same file at fixed geometry and playback settings. Record confirmed transfers/attempts, timeout and retry rates, policy request/confirmation history and end-to-end goodput.

Record individual transfer attempts and quiet/noisy comparisons on the [physical trial sheet](PHYSICAL_TEST_SHEET.md).
