# SONICBRIDGE
> **Offline Communication. Verified Trust. Anywhere.**

SW-41 acoustic multi-scenario communication and trust platform. Connects nearby devices to exchange digitally signed, tamper-evident digital information through speakers and microphones without internet, Wi-Fi, or Bluetooth pairing.

Built with React 19, TypeScript, Vite, Web Audio API, locally bundled ggwave WebAssembly modem, and standard W3C Web Crypto APIs (ECDSA P-256 & SHA-256).

---

## 1. Quick Start

```powershell
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Start Audio on both devices; listen with the receiver's microphone, then transmit from the sender's speaker.

### Key Capabilities
- **Real Acoustic Channel**: Sender Device Speaker ➔ Sound Waves ➔ Receiver Device Microphone ➔ Decoding ➔ Verified Application Message.
- **Local PCM Simulation**: Switch to **Simulation · local PCM** to execute the complete protocol exchange through generated PCM without requiring physical audio hardware.
- **Physical Transfer Boundaries**: Up to 4096 bytes per transfer; negotiated DATA payload of up to 120 bytes per acoustic packet with CRC32 packet integrity and FIN_ACK sender confirmation.

---

## 2. Three Operating Environments

SonicBridge provides three dedicated application experiences powered by a shared acoustic engine, cryptographic identity service, offline persistence, and store-and-forward relay:

### 🚨 Mode 1: SONICBRIDGE RESCUE — Emergency Field Communication
*Tagline: "Communication when infrastructure fails."*
- Structured incident reporting: Incident ID, category (Medical, Search & Rescue, Food/Water, Shelter, Hazard, Logistics), Priority (Critical, High, Medium, Low), location, GPS coordinates (when permitted), affected casualties count, resource requests with urgency.
- Emergency Command Dashboard: Real-time incident counts, critical demands, priority sorting (Critical first).
- Store-and-forward multi-hop relay: Field volunteer (Device A) ➔ Relief coordinator (Device B) ➔ Regional command (Device C).

### 🔒 Mode 2: SONICBRIDGE AIR-GAP — Secure Industrial Data Exchange
*Tagline: "Secure data exchange without network connectivity."*
- Critical industrial asset registry: Machine ID, category (Turbines, PLCs, Generators, Pumps), firmware/config version, operator authorization.
- Cryptographically signed configuration packages: Parameter payloads, SHA-256 content digests, ECDSA P-256 author signatures.
- Quarantine & Approval Screen: Never executes unverified machine code; enforces operator inspection, side-by-side diffs, and cryptographic verification.
- **Live Security Verification**: Built-in tamper test simulation flips bytes in payload or signature to demonstrate real cryptographic rejection (`DIGEST_MISMATCH` / `INVALID_SIGNATURE`).

### 📦 Mode 3: SONICBRIDGE TRACE — Offline Supply Chain Verification
*Tagline: "Every handover. Verified. Offline."*
- Shipment registration: Package IDs, cold-chain temperature constraints, units, quantities, sender and destination organizations.
- Custody Handovers: Cryptographic custody transfers between transit vehicles, depots, and field receiving points.
- Cryptographic Chain of Custody: Append-only hash-linked chain of handovers with signed application-level acceptance receipts.
- Duplicate and replay prevention: Rejects replayed nonces or duplicate handover IDs.

---

## 3. Cryptography & Security Architecture

1. **Web Crypto ECDSA P-256**: Every device generates a persistent ECDSA P-256 key pair in IndexedDB. Private keys never leave the device.
2. **Deterministic Canonicalization**: Payload objects are sorted and canonicalized before SHA-256 hashing to guarantee identical signature verification across platforms.
3. **Replay & Tamper Protection**: Every message carries a unique `messageId`, timestamp, expiration window, and cryptographic `nonce`. Replayed messages and expired packets are immediately rejected.
4. **Local Trust Registry**: Peers can enroll public key fingerprints (`P-256` SHA-256 first 16 hex characters) via QR/text cards to distinguish verified contacts from unknown senders.
5. **Cryptographic Hash-Linked Audit Ledger**: Append-only log where every action is linked to the previous entry via SHA-256 (`prevHash`). Built-in integrity verification detects any modification. Exportable as JSON and CSV.

---

## 4. Live Audio Diagnostics & FFT Visualizer

- **Real-Time FFT Spectrum & Waveform**: Integrated Web Audio `AnalyserNode` provides live frequency spectrum bars and time-domain oscilloscope directly from physical microphone input.
- **Pre-Transfer Device Readiness Checklist**: Verifies AudioContext state, microphone permissions, active listening state, and modem graph sample rates.
- **Clear Method Labeling**: Visually distinguishes `PHYSICAL AUDIO · LIVE MICROPHONE` from `SIMULATION · LOCAL PCM`.

---

## 5. Multi-Scenario Guided Workflows

Each operating environment features dedicated, focused interfaces:

- **Rescue Mesh**: Broadcast critical emergency water/medical requests, triage casualty levels, and coordinate local relief points.
- **Air-Gap Security**:
  - Deploy verified turbine/SCADA calibration packages to air-gapped equipment.
  - Verify cryptographic signatures and test simulated tamper rejection.
- **Supply Chain Trace**: Custody handover tracking for temperature-controlled cold-chain medical shipments with verifiable receipts.

---

## 6. Verification and Testing

```powershell
# 1. Unit & Integration Tests (94 tests across 13 test files)
npm test

# 2. Production Offline PWA Build
npm run build

# 3. Playwright End-to-End Browser Tests (10 tests in Chromium)
npm run test:browser

# 4. Production Service Worker Offline Test
npm run test:pwa

# 5. Paired PCM Acoustic Benchmarks
npm run benchmark
```

All 105 automated tests pass without errors.
