# Contributions

SONICBRIDGE implements the SW-41 application and experimental setup. This inventory attributes components by origin.

| Area | Project work | Upstream foundation |
| --- | --- | --- |
| Audio | Browser device lifecycle, AudioWorklet capture, level diagnostics, calibration, worker adapter and fixture I/O | Web Audio and browser media APIs. ggwave supplies the audible waveform, synchronization, error correction and decoding. |
| Link | Binary packets, CRC coverage, acoustic handshake, duplicate suppression, stop-and-wait, FIN confirmation, negotiated pacing and controller observations | Each complete packet is one ggwave byte message. |
| Content | Manifest, binary chunking, bounds, opt-in thumbnails, verified receipts, safe downloads | SHA-256 implementation from @noble/hashes. Browser image codecs perform local image conversion. |
| Interface and distribution | Transfer flow, event timeline, diagnostics, offline cache and local hosting setup | React, React DOM and Scheduler. TypeScript and Vite build the app. |
| Evidence | Deterministic packet faults, seeded PCM channel, paired trial runner, metrics, physical test sheet and live demo | Vitest drives software tests. Playwright drives browser checks. Benchmark PCM comes from the same upstream codec used by the app. |

The modem adapter uses the released JavaScript/WASM bundle. The project adds a module export for its worker. [ggwave upstream](https://github.com/ggerganov/ggwave)

Two additional projects were research references for acoustic transfer design. Their applications and modems are outside the shipped dependency tree. [audio_data_transfer](https://github.com/melbinjp/audio_data_transfer) · [AcousticNet](https://github.com/g-a-varun/AcousticNet) · [Project research notes](PROJECT.md)

See [third-party notices](THIRD_PARTY_NOTICES.md) for versions and licensing, and [the trial ledger](BENCHMARKS.md) for the scope of the evidence.
