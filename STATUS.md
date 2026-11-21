# SONICBRIDGE Status & Architecture Ledger

Updated: 2026-11-21 (Asia/Calcutta).
Lead Architect & Engineering Manager: Gemini 3.8 Flash (Orchestrator).

---

## 1. Executive Summary

SonicBridge has been transformed from a single-purpose acoustic file link into a multi-scenario offline communication infrastructure with cryptographic identity, tamper-evident verification, store-and-forward mesh relaying, and persistent offline storage.

All existing low-level protocols, modem adapters (ggwave WASM AUDIBLE_FAST), CRC32 framing, StopAndWait retransmission, and FIN_ACK sender confirmation remain fully operational and verified.

---

## 2. Test Verification Matrix

| Test Suite | Framework / Runner | Scope | Result |
|---|---|---|---|
| **Unit & Integration** | Vitest (`npm test`) | 13 test files (Crypto, Envelopes, Storage, Relay, Scenarios, Modem, Transport, Calibration) | **94 / 94 PASSED** (0 failures) |
| **Production Build** | Vite & TypeScript (`npm run build`) | Strict type checking (`tsc --noEmit`), bundling, asset hashing, PWA offline precache | **PASSED** (20 resources precached) |
| **Browser E2E** | Playwright Chromium (`npm run test:browser`) | 10 tests across `app.spec.ts`, `audio.spec.ts`, `console.spec.ts` (WAV decoding at 44.1/48kHz, device routes, 44px touch targets, mobile responsiveness) | **10 / 10 PASSED** (0 failures) |
| **PWA Offline Flow** | Playwright (`npm run test:pwa`) | Production static server with restrictive headers, service worker offline interception, offline reload | **1 / 1 PASSED** (0 failures) |

Total Automated Tests: **105 tests passing**.

---

## 3. Implemented Platform Components

### A. Shared Cryptographic Security Engine (`src/security/`)
- Web Crypto ECDSA P-256 key pair generation and IndexedDB storage.
- Canonical JSON serialization (`src/security/canonical.ts`) for deterministic hashing.
- SHA-256 payload digest verification.
- Tamper detection: modifies to payload or signature cause immediate cryptographic rejection.
- Replay protector (`src/security/replay.ts`): tracks message IDs and sender nonces over 48-hour windows.
- Local Trust Registry (`src/security/trust.ts`): peer device enrollment and fingerprint comparison.

### B. Persistent Offline Storage & Hash-Linked Ledger (`src/storage/`)
- IndexedDB database (`SonicBridgeOfflineDB` with in-memory fallback for headless environments).
- Stores for incoming messages, outgoing queue, relay queue, and audit entries.
- Cryptographic hash-linked audit ledger (`src/storage/audit.ts`): each event points to previous entry via SHA-256 (`prevHash`).
- Built-in `verifyIntegrity()` method detecting any retroactive tampering.
- Audit export to JSON and CSV.

### C. Multi-Hop Store-and-Forward Relay Engine (`src/relay/`)
- Autonomous acoustic relaying: Device A ➔ Device B ➔ Device C.
- Loop prevention: rejects messages originating from self or already present in `relayHistory`.
- Hop limit enforcement: bounded hop count (`hopCount <= maxHops`).
- Signed `RelayReceipt` and signed `DeliveryReceipt`.

### D. Three Operating Environments (`src/scenarios/`)
1. **SONICBRIDGE RESCUE**: Structured emergency reports (Incident ID, category, priority, GPS, casualties, resource requests), emergency command dashboard, priority sorting (Critical first).
2. **SONICBRIDGE AIR-GAP**: Industrial asset inventory, configuration packages, quarantine inspection, operator approval, and live tamper rejection test.
3. **SONICBRIDGE TRACE**: Physical shipments, custody handovers, duplicate handover prevention, and verifiable chain-of-custody timeline.

### E. Live Audio Diagnostics & Spectrum Visualizer (`src/components/AudioVisualizerView.tsx`)
- Web Audio `AnalyserNode` connected to active capture stream.
- Real-time FFT frequency spectrum bars and oscilloscope waveform canvas.
- Pre-transfer device readiness checklist (Context state, microphone permission, active graph sample rates).
- Clear labeling distinguishing `PHYSICAL AUDIO · LIVE MICROPHONE` from `SIMULATION · LOCAL PCM`.

### F. Unified Operational Scenario Workspaces
- Dedicated tabbed views for Rescue, Air-Gap (with tamper test verification), and Trace.
- Responsive, spacious layouts with uncluttered navigation.
