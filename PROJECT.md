# SONICBRIDGE — SW-41 Acoustic Data Link

## Objective and boundaries

Transfer text and tiny images between phones and laptops through speaker → air → microphone. All interdevice payloads, ACKs, negotiation, and recovery must be acoustic. Loading static application assets over HTTP/HTTPS is allowed; HTTP is never a payload transport. There are no sockets, WebRTC, peer APIs, cloud services, or network fallback in the application.

The current slice implements v1 reliable packets, worker-based real-time audio, input/device diagnostics, interruption cleanup, user-triggered bidirectional calibration, an offline-capable production PWA, PCM simulation, and WAV packet inspection. SHA-256-verified text, images and small files are supported. Crash-resumable sessions, authentication, and simultaneous-sender arbitration remain future work. Sender success requires receiver-verified FIN_ACK; playback alone never confirms delivery. See [PROTOCOL.md](PROTOCOL.md) for the wire format, [AUDIO.md](AUDIO.md) for audio architecture, [HTTPS.md](HTTPS.md) for phone setup, and [DEVICE_TEST_MATRIX.md](DEVICE_TEST_MATRIX.md) for honest validation coverage.

Workspace inspected on 2026-11-20: directory empty; no Git repository, existing code, or uncommitted files; no AGENTS.md found in workspace or applicable ancestor directories. No existing work was overwritten.

## Run and debug

Requirements: Node.js 24 (validated with 24.20.0), npm, current browser with Web Audio, AudioWorklet, WebAssembly, and microphone support.

```powershell
npm ci
npm run dev
```

Open http://localhost:5173 on a laptop. Click **Start Audio** on both devices to resume each AudioContext from a user gesture. On the receiving device click **Listen with microphone** and grant permission. On the sender select text, image or a small file within the displayed byte budget and click **Send through speaker**; its microphone is also requested to receive acoustic replies. The body is split into at most 120-byte DATA chunks after negotiation. Use moderate volume, nearby devices, and a quiet room; start with a short message. Keep both pages foregrounded. **Cancel transfer** aborts the operation and attempts an acoustic CANCEL; Stop listening/audio releases tracks and ends that transport lifecycle.

Phones require a trusted HTTPS origin. A plain HTTP LAN URL served by Vite is not sufficient for microphone access or service workers. Build dist and follow HTTPS.md to use the included certificate-configurable local HTTPS static server. Certificate/trust instructions and static hosting assets are prepared; no certificates/trust settings were installed and nothing was published. Production builds precache every required local resource, including JS/embedded WASM, workers/worklet, styles, manifest and icons. Wait for Offline app ready before disconnecting. First load/install downloads static assets; subsequent payload/control traffic is exclusively acoustic. Browser/OS storage eviction can require a fresh online load. Development mode deliberately has no service worker.

**Simulation · local PCM** runs two protocol endpoints and actual modem instances through generated PCM in both directions, using a seeded virtual clock. It completes the full HELLO/CAPS → DATA/ACK → FIN/FIN_ACK exchange without speaker/microphone use. Results are tagged SIMULATION / PCM / VERIFIED. **Export WAV** saves the latest outgoing packet waveform as mono PCM16 with its real sample rate; **Import WAV** decodes mono PCM16/float32 WAV and validates v1 packets in isolation. Imports display packet metadata tagged WAV FIXTURE / PACKET INSPECTION, never a confirmed transfer. Legacy unframed text WAVs are no longer accepted as v1 packets. Existing WAV format/rate/20 MB checks remain. Parser support for 8–96 kHz does not imply validated performance at every rate; 44.1/48 kHz are tested.

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:pwa
```

## Architecture

```text
React UI ── StopAndWait / binary packet codec ── PacketChannel ── modem adapter
                                                   │
 TX: content manifest + binary bytes → packet + CRC → ggwave → PCM → AudioBufferSource → speaker
 RX: mic → AudioWorklet → bounded PCM pool → dedicated ggwave worker → packet checks → reassembly + CRC → inbox
 Reply path: receiver state machine → CAPS / ACK / FIN_ACK → same speaker path

 Debug only: two protocol peers ↔ generated/decoded PCM ↔ virtual clock
 Debug only: packet PCM ↔ mono WAV → isolated modem → tagged packet inspection
```

- `src/content.ts` packs a bounded filename and digest with raw bytes. The receiver checks it before FIN_ACK. `src/images.ts` handles local image inspection and opt-in thumbnail encoding. `src/file-preview.tsx` exposes verified downloads and raster previews.
- `src/protocol.ts`: big-endian versioned binary envelope, CRC32, exact message shapes, capability metadata, and budget/resource validation. 140-byte decoded limit minus all 20 overhead bytes yields 120 DATA bytes.
- `src/transport.ts`: injected PacketChannel/Clock state machine, exact-identity waiters, retries, sequencing, bounded reassembly, verified completion, duplicate/replay records, cancellation, and terminal failures. No ggwave or browser API dependency.
- `src/clock.ts`: monotonic production clock and seeded virtual clock; cancellation applies to every timer. `src/simulation.ts` implements the ideal acoustic PCM channel using real modem encode/decode.
- `src/modem.ts`: sole ggwave dependency boundary; binary encode/decode, explicit 140-byte limit, F32 samples, audible-fast encoding, owned WASM return copies, batched decode, receive-state reset, and instance lifetime. Text helpers remain for diagnostics/tests. Factory injection lets headless tests run the actual package runtime. The Emscripten module is cached; handles are freed separately.
- `src/audio.ts`: PacketChannel over explicitly activated Web Audio, effective permission/constraint reporting, best-effort device selection, actual graph-rate PCM, abortable speaker playback and restrained 60% gain over the modem's 25% waveform. Background/freeze, context interruption, route/device changes, track ending/muting, capture stalls and overflow stop audio and require a new visible activation. Partial resets and a 250 ms echo exclusion prevent local playback entering reception; peer guard remains 500 ms.
- `public/capture-worklet.js`: real-time mono downmix and RMS/peak/clipping/silence diagnostics, silent output, and an eight-buffer recyclable 4096-sample pool (~128 KiB). No per-quantum owned buffer allocation or unbounded capture queue. Telemetry updates the UI at ~4 Hz; overflow is explicit, not silently hidden.
- `src/worker-modem.ts` / `src/modem-worker.ts`: bounded RPC/transferable PCM bridge and dedicated worker holding real-time ggwave DSP, away from React and the main UI thread. The graph's actual sample rate configures modem input/output; internal rate remains 48 kHz. The 4096-sample batching workaround at 44.1 kHz is retained and covered by live synthetic capture tests.
- `src/audio-diagnostics.ts`: supported-constraint requests and effective-settings comparison. True/false/undisclosed/unsupported are distinct; input level is not interpreted as delivery or SNR. Hardware/OS DSP cannot be guaranteed off merely from a browser-reported setting.
- `src/calibration.ts`: one-shot receiver arming and fresh nonce request/reply across two complete reliable acoustic transfers. Receiver waits for FIN_ACK turnaround before initiating the response. No tone-only or automatic unarmed response is called calibration.
- `src/pwa.ts`, `scripts/build-offline.mjs`: production registration, whole-build hashed precache inventory, explicit update action, offline shell and local DSP assets. `scripts/serve-https.mjs` and hosting/ prepare static serving with correct MIME/cache/CSP rules, without publishing.
- `src/wav.ts`: bounds-checked RIFF parser and PCM16 export, independent of browser audio APIs.
- `src/main.tsx`: microphone/simulation modes, sender progress and cancellation, verified-transfer receipt provenance, WAV packet inspection, actual errors, and bounded 100-message inbox. Incoming text appears only after receiver FIN integrity verification. No fabricated messages.
- `public/vendor/ggwave.js`: exact pinned npm runtime with embedded WASM, retained for local non-real-time diagnostics/simulation. `ggwave-module.mjs` is the identical source plus an explicit default factory export for the dedicated module worker. prepare-runtime.mjs verifies version 0.4.0 and generates both before dev/build. Both are local and precached, with upstream MIT notice. Tests verify byte identity and embedded WASM. The runtime uses generated binding functions, so hosting CSP must permit its documented unsafe-eval requirement.

## Upstream investigation (2026-11-20)

1. [ggerganov/ggwave](https://github.com/ggerganov/ggwave): selected waveform modem. Upstream describes FSK with Reed-Solomon error correction and small payloads. Reviewed the [JavaScript binding documentation](https://github.com/ggerganov/ggwave/blob/master/bindings/javascript/README.md), installed package manifest, `emscripten.cpp`, and actual runtime exports. npm version is 0.4.0; `main` is `ggwave.js`, with no exports map or TypeScript declarations. Confirmed `getDefaultParameters`, `init`, `free`, `encode`, `decode`, `SampleFormat.GGWAVE_SAMPLE_FORMAT_F32`, and `ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST`. Installed README's `TxProtocolId` example is stale. Binding encode accepts a UTF-8 string; encode/decode return borrowed byte views, not an AudioBuffer or decoded string. The 140-byte variable payload limit is confirmed in the [header](https://github.com/ggerganov/ggwave/blob/master/include/ggwave/ggwave.h). No DSS mode is enabled in this slice. Existing interoperability with arbitrary third-party apps is not claimed.
2. [melbinjp/audio_data_transfer](https://github.com/melbinjp/audio_data_transfer): reviewed its README architecture and operating instructions. It describes a custom browser 4-FSK stack, CRC32 framing, acoustic stop-and-wait ACKs, and backoff. Useful direction for subsequent browser reliability work; its modem/protocol is separate from ggwave and has not been integrated or assumed compatible.
3. [g-a-varun/AcousticNet](https://github.com/g-a-varun/AcousticNet): reviewed README's layer boundaries and reliability discussion. It uses a Python modem and separates link, ARQ, framing, and file transfer. This motivates keeping SONICBRIDGE's modem replaceable and implementing reliability above it. Its routing/encryption and claimed measurements are upstream claims, not SONICBRIDGE validation. No source code from this project is incorporated.

Browser API references checked: [AudioWorkletNode](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode), [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Both capture and worklets require a secure context; permission and browser audio activation remain independent requirements.

## Milestones and acceptance criteria

| Milestone | Scope | Acceptance |
| --- | --- | --- |
| M1: first vertical slice | Local modem, UTF-8 text, speaker/microphone graph, fixtures, simulation, errors | Actual WASM encode → chunked PCM → decode matches UTF-8; WAV round trip passes; typecheck/build pass; browser paths execute; physical tests reported separately |
| M2: measured acoustic baseline | Phone/laptop cross-device validation over trusted HTTPS | Record devices, OS/browser, rate, distance, volume, payload, successful/attempted counts, and failures in both directions; test denied permission and interrupted capture |
| M3: reliable acoustic link | V1 framing/CRC, HELLO/CAPS, DATA/ACK, FIN/FIN_ACK, retry/backoff, bounded replay storage, cancellation | Software implemented and fault/PCM/browser tests pass; physical acoustic reliability remains pending. Bad packets use timeout recovery rather than a NACK type; no network controls |
| M4: tiny images | Explicit size limit, chunks, metadata, integrity hash, bounded reassembly, image preview | Software verified for original images, thumbnail copies, opaque files, SHA-256, lost and duplicate chunks. Physical verification and durable session resume remain pending. |
| M5: challenge hardening | Offline PWA, worker DSP, diagnostics, lifecycle cleanup, calibration and phone setup | Software implemented and production/offline tests pass; physical mobile installation, OS interruption, route behavior and acoustic measurements remain pending in DEVICE_TEST_MATRIX.md |
| M6: adaptive transport | Fixed Balanced and Robust, evidence-driven transitions and acoustic policy confirmation | Software verified with lost switch requests/replies, stale echoes, retry bounds and reproducible PCM comparisons across four channels. Hardware measurements pending. |

## Known risks and constraints

- No physical phone/laptop acoustic test has been performed. Synthetic capture and perfect PCM do not establish room performance.
- Narrow throughput makes even tiny images slow. Chunking must account for framing overhead inside the 140-byte modem payload.
- Packet and whole-body CRC32 plus exact ACK matching are implemented above ggwave FEC. They provide integrity/error recovery, not authentication or encryption. Manifest text must be valid UTF-8 before FIN_ACK.
- Acoustic interference, multipath, clipping, device filtering, AGC, sample-rate changes, and competing transmissions can prevent decode. Current silence/no-packet is a waiting state, not a fabricated modem error. The JS decode binding does not expose detailed demodulation failure reasons.
- Real-time modem DSP now runs in a dedicated worker with bounded capture buffers. Actual phone CPU/latency profiling is still pending; overflow stops rather than accumulating stale audio. Offline WAV inspection and accelerated PCM simulation remain non-real-time main-thread debugging tools and can pause the UI.
- Half-duplex reset, timestamp suppression, and guards are implemented; physical echo/turnaround tuning is unverified. All controls remain on one receive-capable baseline. Concurrent initiators fail within bounded attempts rather than automatically electing a role.
- Replay/deduplication records are bounded to 32 identities retained for 10 minutes, without evicting live records. When full, new HELLO is ignored until expiry. Restarting audio/changing modes clears replay history. Durable replay protection and crash recovery are not implemented.
- Backgrounding/screen locks/interruptions and detectable route changes deliberately cancel audio rather than auto-resume. User must return, Start Audio, listen and recalibrate. Some OS route/lock transitions are not disclosed by every browser; physical behavior is unverified. No screen-wake guarantee or unattended background transfer is claimed.
- There is no encryption/authentication; nearby listeners can receive messages. This is an acoustic challenge prototype, with no claim of private transport.

The sender controller records recent DATA outcomes, packet validity and confirmed content goodput. See [ADAPTIVE.md](ADAPTIVE.md) for decision thresholds, runtime probes and trial results.
