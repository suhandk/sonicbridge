# SONICBRIDGE status

Updated: 2026-11-20 (Asia/Calcutta).

## Paired evaluation and demonstration

The real-codec PCM runner compared identical 480-byte transfers across three traces, four paired seeds and three modes. All 12 quiet transfers completed. All 12 burst-noise transfers reached the trial deadline, including the four Adaptive transfers that negotiated Robust. The 12 weak-return trials exhausted capability negotiation. No mode improved the completion count. The full ledger retains every attempt, measured virtual elapsed time, verified bytes and retry count. Physical trials completed: zero. [Methods, results and reproduction](BENCHMARKS.md)

The stage plan uses a fresh audience-selected text after offline reload. The image slot requires a timed rehearsal on the same device pair. The fallback uses visibly labeled local PCM. [Demo](DEMO.md) · [Physical trial sheet](PHYSICAL_TEST_SHEET.md) · [Attribution](THIRD_PARTY_NOTICES.md)

## Current result

The responsive transfer console has separate Physical Audio and Simulation modes, device checks, send and receive controls, a bounded PCM scope, a transfer monitor, verified receipts and expandable technical details. Sender confirmation requires FIN_ACK. Receiver verification is displayed separately from the state of its outgoing reply.

Fixed Balanced, fixed Robust and Adaptive are implemented for content transfers. All three use Audible Fast. The UI displays measured ACK/timeout/retry rates, decoder outputs, confirmed content goodput and decision reasons. Physical modem switching and physical validation are pending. [Controller measurements](ADAPTIVE.md)

The reliable link now carries SHA-256-verified text, PNG/JPEG images and arbitrary small files. The 4096-byte body budget includes a 37-byte fixed manifest plus 1–64 filename bytes. Original image transfer is the default. Local thumbnail compression requires an explicit click.

Real audio uses an AudioWorklet plus a dedicated modem DSP worker with bounded recycled PCM buffers. Explicit activation, effective microphone diagnostics, best-effort device choice, interruption cleanup and a two-device calibration exchange are implemented. A production offline PWA and local HTTPS/static-hosting assets are prepared. **Nothing has been published, no CA/trust settings were installed, and physical phone/laptop acoustic validation remains PENDING.** All interdevice payloads, calibration and control messages remain acoustic.

## Completed

- Replaced the decorative signal illustration with a waveform and time-frequency view drawn from actual microphone blocks or encoded modem output. Each view uses at most 2048 samples and refreshes at up to 4 Hz. Reduced-motion preference pauses the initial display. The scope labels sample source, graph rate and timespan.
- Added a 40-event in-memory packet timeline with local TX submissions, decoded packets, timeout events, sequences and attempts. The monitor displays negotiated pacing, actual local retries, physical or simulated elapsed time, acknowledged sender bytes or unique reassembled receiver bytes. It starts ETA from the overhead-aware model (or prior measured timing) and updates from unique progress intervals with a six-second FIN exchange allowance. Unknown times are shown as estimating.
- Microphone capture for diagnostics requires the explicit five-second recording button inside Technical details. The clip uses bounded RAM, is cleared on discard or input shutdown, and requires a separate export click to save. Outgoing and imported WAV fixtures retain their separate export action. There is no automatic persistent microphone recording.

- Added CONTENT_HELLO/CAPS negotiation and a versioned binary manifest. The receiver checks the offered allocation and chunk count, validates the manifest length on arrival, and requires complete reassembly, CRC32 and whole-content SHA-256 before FIN_ACK. Legacy text and calibration paths still receive their original packets.
- Progress counts unique content bytes acknowledged. Metadata and duplicate ACKs do not advance it. The rate display separates raw modulation from confirmed end-to-end microphone goodput. Initial estimates account for metadata, framing, replies, FEC/marker airtime and guards. Measured estimates scale by prior confirmed microphone timing.
- Implemented local PNG/JPEG inspection, opt-in bounded thumbnail trials and exact size/target reporting. Source limit 6 MiB and 12 MP. Receiver preview limit 262144 pixels and one open received image. Up to 20 receipt bodies occupy at most 81920 bytes excluding browser object, text and decoded-image overhead. Filenames are bounded, normalized and sanitized. Arbitrary files download with an inert .bin suffix.

- Inspected existing PROJECT.md, STATUS.md, audio/modem/transport/UI/tests and applicable instructions. No AGENTS.md or Git repository exists in this workspace. Preserved the v1 packet protocol, transport fault tests, bundled runtime, UTF-8 messaging, WAV tools and simulation.
- AudioContext start/resume occurs only through the visible Start Audio / Resume Audio interaction. Listen, Send and protocol callbacks do not silently resume it.
- Moved actual encode/decode/reset to a dedicated module worker. The verified ggwave adapter remains the API boundary. Generated local ES-module runtime is the exact pinned 0.4.0 source plus a default export; its WASM remains embedded. No CDN/runtime transport substitution.
- AudioWorklet performs mono capture/level DSP using eight recycled 4096-float buffers (~128 KiB PCM). Bounded RPC, buffer-overflow diagnostics and capture/DSP watchdogs prevent unbounded real-time backlog. React receives telemetry at approximately 4 Hz, not microphone PCM for analysis.
- Actual graph rate configures modem input/output. Browser track-to-graph resampling and ggwave's internal 48 kHz conversion are distinguished. Effective track/graph rates are displayed, including undisclosed track settings.
- Supported echo cancellation, noise suppression and AGC constraints request ideal false. Effective settings distinguish off, ignored/on, undisclosed and unsupported. Browser-reported settings do not guarantee OS/hardware DSP is absent.
- Added RMS/dBFS/peak, latched clipping (absolute sample >=0.98), near-silence (3 seconds), dropped samples, permission and actual input diagnostics.
- Added microphone choice with a one-time unavailable-device fallback, effective input reporting, enumeration refresh and best-effort AudioContext output selection. Unsupported output selection directs users to OS controls. Output changes require explicit restart/recalibration.
- Default GainNode is 0.6 over ggwave's 25% waveform, about 15% digital full scale. OS speaker volume is separate.
- Added cleanup for context interruption/suspension, background/freeze/pagehide, device/sink changes, track end/mute, stalled capture and overflow. Stop terminates DSP, closes nodes/ports/context, stops tracks and cancels protocol/calibration. Late microphone permission/worklet startup cannot revive stopped audio. No automatic background continuation is claimed.
- Calibration requires explicit receiver arming and a fresh eight-byte nonce. Request and reply each use the complete reliable acoustic transfer protocol. Receiver waits for FIN_ACK turnaround before replying; stale/wrong nonce results, timeout and cancellation are covered. Metrics/flags are advisory, not an SNR/range estimate or sensor attestation.
- Production PWA includes manifest/icons, atomic whole-build precache, explicit readiness/failure messages and user-triggered stop/reload updates. Local JS/embedded WASM, worker, worklet, CSS and required assets are included. Development mode deliberately skips service-worker registration. No payload/microphone recording enters the static cache.
- Prepared HTTPS.md, AUDIO.md, DEVICE_TEST_MATRIX.md, local certificate-configurable HTTPS static server, hosting headers/instructions and production build output. No hosting account or public endpoint was configured.
- Prepared hosting/sonicbridge-static.zip with the 16 production files plus hosting headers; verified every build file against its archive entry by SHA-256. No certificates/private keys are included.

## Checks and evidence

| Check | Result |
| --- | --- |
| npm run benchmark | PASS twice. All 36 trial records reproduced byte-for-byte, including all incomplete outcomes. SHA-256 of evaluation/results.json: 7e8a79f9b5ffe886aa8de30d150cea23a5a11596eb23af9d40f080c50b6b39dc |
| npm run build | PASS: strict TypeScript and Vite build; generated whole-build offline inventory/service worker with 16 precached local resources |
| npm test | PASS: **73 tests across 10 files**: seeded sample continuity, cross-rate propagation and finite echoes, existing modem/WAV/packet/transport faults, processing settings, worklet downmix/levels/clipping/silence/pool bounds, runtime byte identity, calibration parsing/arming/stale nonce/cancellation, full bidirectional calibration through actual ggwave PCM, random binary bytes, Unicode names, independent SHA-256 reference, empty files, invalid/oversized manifests, wrong hashes, file cancellation, middle-chunk loss, masked retries, duplicates, exact progress and unsupported peers |
| npm run test:browser | PASS: **9 Chromium tests**: prior UI/Unicode/WAV/permission checks; complete scripted protocol receive through actual worklet + dedicated worker at forced 44.1 and 48 kHz; cleanup after real context suspend plus injected route/background events; stopped pending-permission stream cleanup; actual Web Audio resampling 48→44.1 and 44.1→48 followed by decode; sender-side FIN_ACK through a real-codec PCM peer feeding a synthetic microphone; keyboard, reduced motion, 44 px control heights at four widths, and a downloaded WAV with exactly five seconds of samples |
| npm run test:pwa | PASS: **1 production test** on the prepared static server with same-origin CSP/MIME/cache headers. Verified complete cache inventory, offline navigation from service worker, offline worker/embedded WASM/worklet loading, microphone initialization and offline content negotiation/Unicode transfer. Verified original PNG bytes on download, a below-target thumbnail, an oversized 480 × 320 image resized to a 96 × 64 JPEG (2571 bytes in this Chromium run), its verified receiver preview, and exact binary HTML-like content downloaded without inline rendering |
| Real codec integration | PASS: full 140-byte binary modem budget at 44.1/48 kHz; reliable HELLO/CAPS, DATA/ACK, FIN/FIN_ACK and calibration challenge/reply through actual generated/decoded PCM |
| Device diagnostics | PASS in software: ignored/undisclosed/unsupported processing settings, 60% default gain, 4 Hz telemetry, pool cap/overflow and late stream cleanup |
| Interdevice network traffic | None introduced. Existing browser workflow checks reject external app requests; production cache contains static resources only |
| Controller comparison | Actual codec/PCM, four deterministic channel conditions across three modes. Balanced and Adaptive confirmed 2/4 transfers each, Robust 3/4. Adaptive tied Balanced on clean PCM and had lower goodput with periodic reverse-path loss. |
| Controller safety | Lost requests and confirmations, stale echoes, six-attempt ceiling, fast fallback, recovery dwell, fresh baseline after an ambiguous switch and offline UI negotiation passed. |
| Actual Android Chrome / iPhone Safari / desktop hardware acoustics | **UNTESTED** |
| Native phone PWA install, storage eviction, CA trust and OS audio-route/screen-lock behavior | **UNTESTED** |
| Public deployment | **NOT PERFORMED** |

Environment: Windows, Node 24.20.0, npm 11.19.0, Playwright 1.65.1 full Chromium 159. Browser audio tests use WAV-fed capture, synthetic microphone streams or browser fake devices. No physical recordings were used. Offline reload tests use the localhost secure-context exception, not an asserted phone HTTPS trust test. Responsive checks covered 320, 390, 768 and 1440 CSS pixels. Desktop and phone-width Chromium screenshots were inspected. These are software layout checks. Current matrix marks all actual Android/iPhone and physical cross-device combinations untested.

## Failures found and fixed

- Moving device telemetry into a disclosure changed its visible flow. The production offline browser test now opens Technical details before reading the live permission field. It also opens the packet timeline, checks FIN_ACK, and switches the actual PCM plot to the spectrogram.

- The real codec repeatedly failed to decode a particular 140-byte packet containing JPEG color-profile data, even through clean PCM. Negotiated content DATA now uses reversible length-preserving whitening, with a second waveform mask on alternate attempts. The same 2571-byte JPEG subsequently passed the complete offline WASM/PCM transfer. Retry tests include a lost ACK across the two masks.
- A hand-copied test PNG had a recognizable header but failed browser decoding. The browser test now generates its fixture with canvas and compares the downloaded bytes with that original.

- Dedicated workers require an ES-module factory export. Prepared the same verified local runtime with an appended export, rather than depending on nonexistent upstream ESM exports or a CDN. Tests prove byte identity of the source and successful production worker loading.
- Startup/resume needed to distinguish gesture activation from protocol callbacks. Removed automatic resume from capture/playback and stop on interruption; added generation checks for pending permission/worklet startup and preserved the interruption reason against late asynchronous errors.
- Browser route test initially fired before asynchronous Start Audio initialization finished. It now waits for the ready state before asserting interruption; actual context suspension and all cleanup checks pass.
- Worklet silence test expectations initially ignored the quarter-second telemetry window; corrected the test duration rather than weakening silence thresholds.
- TypeScript DOM typing requires an owned ArrayBuffer-backed PCM copy for copyToChannel in the resampling test; fixed and rebuilt successfully.
- Inspected the pinned binding's generated-function usage; prepared hosting CSP includes the runtime's actual unsafe-eval requirement. Production/offline tests exercise this policy.
- Extended the lifecycle check with an injected idle DSP-worker error; fatal worker failures now tear down audio even when no RPC is in progress, and require an explicit fresh start. Stopped input is labeled as stopped, with retained metrics labeled Last capture.

## Limitations and blockers

No remaining software build/test blocker for this slice. Physical validation requires actual phones/laptops, microphone permission, trusted HTTPS and local network reachability for first load/install.

- No over-air calibration, retry reliability, distance/volume, hardware clipping, physical route changes, phone calls, screen locks, Safari interruption or long-run CPU/clock drift measurements have been performed.
- Default echo exclusion/turnaround remains 250/500 ms. Bounded buffers fail visibly if a device cannot keep up; phone performance and appropriate timing remain unmeasured.
- Processing flags are best-effort browser reports. Enumeration/output selection and permission queries vary by browser; undocumented OS route changes may only be noticed through a later stall/error.
- Offline cache can be evicted, first-ever offline load cannot work, and native installation UI has not been manually tested. Update application is implemented but multi-version/multi-tab update behavior has not been manually validated; stop audio in all tabs before updating.
- WAV inspection and accelerated PCM simulation remain synchronous non-real-time debugging utilities on the main thread.
- The existing protocol still has a 4096-byte/128-chunk limit, bounded 10-minute replay history, no authentication/encryption, no automatic simultaneous-sender election and no crash-resumable transfer. Receiver verification and sender FIN_ACK confirmation remain separate states.
- Durable session resume remains pending until file transfers are measured across physical devices. A cancellation, audio restart or page reload discards partial content. Both endpoints need the content-aware build to send a new file. Sender authentication and confidentiality remain outside this slice.

## Exact next step

Load the same production build on laptops A and B over trusted HTTPS. Verify offline reload, disconnect networking, calibrate, then record the first quiet A-to-B Balanced transfer and its matching Robust and Adaptive trials on the [physical sheet](PHYSICAL_TEST_SHEET.md). Continue the reverse direction, phone pairs and both noise conditions. Rehearse the exact image before allocating stage time. Record permission and interruption behavior in [the device matrix](DEVICE_TEST_MATRIX.md).
