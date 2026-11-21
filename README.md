# SONICBRIDGE

## Run and evaluate

SW-41 acoustic text, image and small-file link with versioned binary packets, CRC32, acoustic negotiation/ACKs, stop-and-wait recovery, and receiver-verified completion. Built with React, TypeScript, Vite, Web Audio, and locally bundled ggwave WASM.

```powershell
npm ci
npm run dev
```

Open http://localhost:5173. Start Audio on both devices; listen with the receiver's microphone, then send the selected content through the other device's speaker. Both peers need microphone permission for acoustic control replies. Sender success requires FIN_ACK. Cancel transfer stops pending work. Phones need a trusted HTTPS origin for microphone access.

Use **Simulation · local PCM** for a full protocol exchange through real modem PCM without acoustic hardware. Export/import WAV for packet inspection. Simulation and fixture results are labeled separately from verified microphone receipts. A transfer holds 4096 bytes including its manifest and UTF-8 filename; the negotiated DATA payload is at most 120 bytes per packet.

Inspect the device/input check panel before use. On the second device tap **Arm calibration receiver**, then **Calibrate link** on the first. The exchange uses both devices' speakers and microphones. Keep screens unlocked and pages foregrounded. After interruptions or route changes, explicitly Start Audio/listen and recalibrate.

Production builds are an offline-capable PWA: first load/install online over trusted HTTPS, wait for **Offline app ready**, then verify offline reload. Later payloads and replies use sound only. Development mode has no service worker. The entire hosting folder/dist output is prepared locally; nothing is published.

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:pwa
```

For phone testing follow [HTTPS.md](HTTPS.md), then `npm run serve:https` with your trusted local certificate. Ordinary HTTP LAN URLs are insufficient. See [AUDIO.md](AUDIO.md) for diagnostics/worker behavior, [PROTOCOL.md](PROTOCOL.md) for packets/calibration, [PROJECT.md](PROJECT.md) for architecture, [DEVICE_TEST_MATRIX.md](DEVICE_TEST_MATRIX.md) for untested combinations, and [STATUS.md](STATUS.md) for results and the next step. Physical-device validation and durable session resume remain pending.

Choose **Image** to inspect a static PNG or JPEG (up to 6 MiB, 12 million pixels, at most 8192 pixels on either side). The app selects the original bytes by default. **Make 1–3 KiB thumbnail** creates a separate, locally resized JPEG with a white background for transparency. The encoded byte count and target result are shown even when outside 1024–3072 bytes. **Use original** restores the untouched source. Oversize content cannot be sent. Animated PNG and compressed PNG metadata are outside the preview subset. Use **Small file** for opaque bytes within the transfer limit.

The receiver retains up to 20 receipts in memory. Only verified image-kind PNG/JPEG bytes within 262144 pixels can be previewed. One received image preview can be open at a time. Other binary content is download-only, including HTML and SVG. Downloads preserve the bytes, use a sanitized Unicode filename, and append .bin. Text renders as plain text. A checksum verifies byte integrity without authenticating the sender.

Choose an **Operating mode** before sending. Balanced uses 500 ms turnaround. Robust negotiates 900 ms DATA and ACK guards and two additional DATA attempts. Adaptive requests those changes based on recent DATA outcomes. Expand **Controller decisions** to inspect the evidence and acoustic confirmations. [Mode definitions and measured comparisons](ADAPTIVE.md)

In **Physical Audio**, start audio, open **Check devices**, and choose **Listen with microphone** on the receiving device. Use the transfer monitor to distinguish acknowledged bytes from final verification. **Packet timeline** shows recent protocol traffic. **Technical details** contains controller policy, calibration, fixture tools and explicit diagnostic microphone recording.

## Architecture

The UI prepares a bounded manifest and raw content. Stop-and-wait frames each chunk with identifiers and CRC32, then the modem adapter encodes the packet as audible PCM. Web Audio plays it. On the peer, the capture worklet feeds a decoding worker. Accepted chunks enter bounded reassembly. The receiver checks the full content digest and sends FIN_ACK through the same acoustic path. Session and receive state live in memory.

Run `npm run benchmark` to regenerate the complete paired PCM ledger with the locked dependencies. Physical testing still requires two devices. [Benchmark methods and results](BENCHMARKS.md) · [Three-minute demo and fallback](DEMO.md) · [Physical test sheet](PHYSICAL_TEST_SHEET.md) · [Contributions](CONTRIBUTIONS.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)

In the instrument console, choose **Receive → Listen with microphone** on the receiving device. On the sender choose **Send**, enter the message, then select **Start transmission**. The transducer and plot use local PCM observations. The plot can be paused independently of the acoustic link.
