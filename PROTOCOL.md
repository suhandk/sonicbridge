# SONICBRIDGE acoustic protocol v1

All peer traffic is modem-encoded sound, including capabilities, acknowledgements, completion, retries, and cancellation. There is no network fallback. Simulation and imported WAV inspection are explicitly local debugging facilities.

## Modem boundary and baseline

The pinned ggwave 0.4.0 variable-length decoded-message limit is **140 bytes**. This is a byte limit, not a character limit or a PCM length. It is recorded as `Modem.maxMessageBytes`, forwarded through `PacketChannel.maxPacketBytes`, confirmed by the upstream header, and exercised with maximum-sized binary frames through the actual WASM encoder/decoder at 44.1 and 48 kHz.

Embind `std::string` accepts a `Uint8Array`: binary is sent directly, preserving NUL and bytes ≥128. There is **no** UTF-8, base64, or hex expansion at the packet/modem boundary. Only text and filenames use UTF-8. Borrowed decode views are copied immediately.

Baseline ID **1** means ggwave `ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST`, variable-length packets, DSS disabled, F32 audio. The internal modem rate remains 48 kHz; input/output rates match the local AudioContext. Every message type uses this baseline. Capabilities can reduce DATA size/transfer limits; they cannot change control modulation or disable baseline reception. Unknown baselines are rejected.

## Packet layout

All multibyte integers, including CRC values, are **unsigned big-endian (network byte order)**. Offsets are zero-based. Packets have exactly one payload and exactly one trailing CRC; trailing bytes are forbidden.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 2 | Magic `0x5342` (`SB`) |
| 2 | 1 | Version, exactly `1` |
| 3 | 1 | Message type |
| 4 | 4 | Nonzero session ID |
| 8 | 4 | Nonzero transfer ID |
| 12 | 2 | Sequence number |
| 14 | 2 | Payload length `L` |
| 16 | L | Payload |
| 16 + L | 4 | Packet CRC32 |

CRC32 uses CRC-32/ISO-HDLC (IEEE): reflected polynomial `0xEDB88320`, initial `0xFFFFFFFF`, final XOR `0xFFFFFFFF`. Test vector ASCII `123456789` gives `0xCBF43926`. Coverage is **every byte from magic through the final payload byte**, offsets `[0, 16 + L)`. The four CRC bytes are excluded. The stored CRC integer is big-endian even though the CRC algorithm is reflected.

Fixed overhead is `16 header + 4 CRC = 20 bytes`. Safe DATA payload is `actual decoded limit − 20`, so **140 − 20 = 120 bytes**. `payloadCapacity()` derives this; neither headers nor integrity bytes are omitted from budgeting. Smaller channel limits negotiate smaller payloads; adapters below the minimum needed for the 15-byte HELLO are unsupported. A full packet can never exceed the adapter's limit or the pinned modem limit.

## Types and payloads

| Type | Value | Sequence | Payload |
| --- | --- | --- | --- |
| HELLO | 1 | 0 | 15 bytes: body byte length u32, complete-body CRC32 u32, offered DATA bytes u16, offered maximum transfer bytes u32, baseline ID u8 |
| CAPS | 2 | 0 | 7 bytes: selected DATA bytes u16, selected maximum transfer bytes u32, baseline ID u8 |
| DATA | 3 | 0 through N−1 | Raw body chunk, 1–selected DATA bytes |
| ACK | 4 | DATA sequence being acknowledged | Empty |
| FIN | 5 | N | 8 bytes: complete-body byte length u32, complete-body CRC32 u32 |
| FIN_ACK | 6 | N | Same 8 bytes as verified FIN |
| CONTENT_HELLO | 8 | 0 | Same offer as HELLO, requires content manifest v1 and SHA-256 verification |
| CONTENT_CAPS | 9 | 0 | Same fields as CAPS, agrees to content v1 and length-preserving DATA whitening |
| CONTENT_DATA_ALT | 10 | Same as DATA | Alternate whitening mask on even-numbered attempts |
| SET_POLICY | 11 | Active content DATA sequence | One byte, Balanced (0) or Robust (1) |
| POLICY_ACK | 12 | Matching switch sequence | Echo of the accepted policy |
| CANCEL | 7 | 0 emitted; any sequence accepted for matching active identity | Empty |

Body CRC32 covers the complete, ordered raw transfer body, independent of packet CRCs. The receiver agrees to the smaller offered/local DATA capacity. CAPS must not increase the sender's offered DATA limit and must support the proposed body length. Both sides enforce `1 ≤ total ≤ 4096 bytes` and `N = ceil(total / selected DATA bytes) ≤ 128`. HELLO's maximum-transfer offer must be at least total and at most 4096. Invalid or unsupported CAPS is ignored; negotiation eventually fails within the retry budget.

Except the final DATA chunk, DATA length must equal the selected chunk size. The last length must be exactly the remaining body length. FIN/FIN_ACK must match both the negotiated length and body CRC, plus the exact identity and final sequence.

## State machine and completion semantics

Each locally initiated transfer generates fresh nonzero random u32 session and transfer IDs using Web Crypto. IDs remain fixed for retries. One sender and one receiver state are supported per endpoint, with one active direction at a time. Simultaneous initiators ignore competing HELLOs and eventually fail with bounded timeouts; automatic role election is not implemented.

1. Sender arms a CAPS waiter, observes the turnaround guard, and transmits HELLO. Receiver validates the packet and offer before reserving one bounded receive buffer, then sends CAPS acoustically.
2. Sender validates capabilities. For each DATA chunk, it arms a waiter for the exact `(session, transfer, sequence, ACK type)`, transmits, and waits. It cannot advance until that ACK arrives. Unknown sessions, wrong transfers, old/future sequences, and wrong response types cannot satisfy the waiter.
3. Receiver accepts only its next expected DATA sequence. It writes the chunk once, then emits ACK. Earlier duplicate DATA must match the already-buffered bytes and expected length; it is ACKed again without writing/delivering again. Future DATA is ignored. Duplicate matching HELLO reuses state and resends CAPS; changed metadata or competing sessions cannot replace a live transfer.
4. Sender transmits FIN only after every DATA ACK. Receiver requires all N chunks, exact total, expected FIN sequence/digest, and a matching computed whole-body CRC. Content transfers additionally require manifest and SHA-256 verification. Only then does it deliver the body once, retire the buffer, and queue FIN_ACK. Receiver state is **received**, not sender-confirmed success.
5. Sender reports **completed / transfer confirmed** only after a matching FIN_ACK with the verified total/digest. A lost FIN_ACK causes FIN retransmission. A retained completion record answers duplicate FIN with FIN_ACK, without delivering again.

Lost DATA, corrupted packets, and lost ACKs cause retransmission of the same outstanding request. Duplicate packets never advance a different waiter. Completed records can also re-ACK valid-length older DATA for that transfer without retaining its body. Retired HELLO is ignored rather than reopening the transfer.

A permanently lost final acknowledgement can leave the receiver with verified data while the sender reports failure/unconfirmed delivery. This is deliberate: the sender never infers success from playback, timeout, DATA ACKs, or a receiver-side UI state. No finite acknowledgement chain can prove to both peers that the final acknowledgement arrived.

## Timing, retries, half duplex, and cancellation

Defaults are local policy, not remotely supplied timers. `Clock` injects `now()`, `sleep(ms, AbortSignal)`, and `random()`; `PacketChannel` injects bounded packet capacity, byte reception, and abortable acoustic playback. Production uses a monotonic clock. Tests and the ideal PCM simulator use seeded `VirtualClock`, with no real sleeps.

| Policy | Default |
| --- | --- |
| Guard before each transmission | 500 ms baseline, 900 ms for negotiated Robust DATA and its ACK |
| Maximum single acoustic playback | 30 seconds, watchdog abort |
| Response timeout | 12 seconds **after local waveform playback ends** |
| Attempt budget including initial transmission | 4 for HELLO, FIN and Balanced DATA, 6 for Robust DATA, 2 for SET_POLICY |
| Backoff before retry `a+1` after failed attempt `a` | `1000 × min(8, 2^(a−1)) × (1 + random[0,1))` ms |
| Receive inactivity expiry | 120 seconds |
| Completed/cancelled/expired identity retention | 600 seconds |
| Retired identity count | 32, no live-record eviction |

Response listeners are armed before playback so an early valid reply is latched. Playback errors/watchdog expiry are terminal local audio failures, rather than repeated attempts against a broken device. Constructors reject timer configurations whose inactivity/retention bounds are shorter than the conservative retry/playback horizon (including maximum jitter).

AudioLink keeps microphone capture active for control replies, but suppresses modem input during local playback. It resets partial modem state at playback start/end, ignores timestamped queued worklet batches during playback and for a 250 ms echo tail, then resumes baseline decode. The 500 ms peer guard is longer than this local echo exclusion. These starting values are not physically tuned; long room echoes may require adjustment. No outgoing body is routed into its own UI. The protocol additionally ignores local request types while an outgoing transfer is active.

There is at most one pending acoustic reply, with no unbounded reply queue. Duplicates while the slot is busy are recovered by sender retries. Starting a new send while receiving or replying returns a useful busy error.

Local cancellation aborts waiting, backoff, guard, or playback via AbortSignal. A bounded one-shot CANCEL is then sent acoustically when possible. Receiver cancellation discards partial state, retains its identity, and sends CANCEL. A matching remote CANCEL aborts an active sender. CANCEL itself is best effort and unacknowledged; if lost, the peer reaches its normal bounded failure/expiry. Cancellation after receiver completion cannot retract delivered data. Stopping audio disposes waiters/timers/subscriptions and clears the lifecycle's replay cache.

## Validation and resource bounds

Before constructing a payload view, the parser checks actual packet size, magic, supported version, type-specific length, declared length, IDs, handshake sequence, and packet CRC. HELLO metadata and selected chunk count are checked **before allocating any reassembly buffer**. Unknown DATA/FIN cannot allocate receive state. No remote field controls an allocation beyond 4096 bytes or the 128-chunk bound.

Memory per transport is bounded to one outgoing body copy (≤4096), one incoming body (≤4096, with only one direction active), one reply, one response waiter, and at most 32 small retirement records containing metadata, not bodies. A retirement slot is reserved at HELLO acceptance. When all 32 slots are retained, new HELLOs are ignored until expiry; live FIN replay protection is preserved. Receiver inactivity discards abandoned bytes and retires the identity.

Replay/deduplication guarantees apply within the 10-minute retention window and the running transport lifecycle. After expiry, browser restart, Stop Audio, or mode change, a recorded old HELLO train could be accepted again. CRC is not authentication; this protocol does not defend against deliberate valid-CRC forgery or cryptographic replay. The combined random ID pair reduces accidental identity collisions but does not authenticate a peer. Durable replay protection/authentication, simultaneous-sender arbitration and crash-resumable sessions remain future work.

## Verification boundary

Packet tests cover byte order, maximum sizes, CRC reference vector, single-byte corruption across every packet byte, unsupported versions, invalid lengths and resource offers. Deterministic transport tests cover loss of each handshake/data/completion type, duplicate and reordered packets, delayed/stale ACKs, stale HELLO, cancellation, receiver expiry, retry exhaustion, whole-body integrity failure, echo routing, bounded replay storage, and hung playback.

Integration tests additionally round-trip maximum binary packets through actual local ggwave WASM/PCM at 44.1/48 kHz and run a multi-chunk HELLO/CAPS → DATA/ACK → FIN/FIN_ACK transfer through real generated/decoded PCM in both directions. Browser tests exercise the microphone/worklet protocol receiver using a scripted WAV input and actual acoustic control waveform playback. These are software/synthetic tests. **Physical phone/laptop delivery, echo behavior, negotiation and retry timing over air remain pending.**

## Application calibration envelope (not a packet-version change)

Legacy HELLO bodies can carry raw UTF-8 text. New outbound text uses the content manifest. Calibration reserves a body prefix `FF 53 42 43` (invalid as UTF-8 text) followed by application version u8 `1`, calibration kind u8, and an eight-byte random nonce. Request kind 1 has exactly 14 total bytes. Reply kind 2 has exactly 23 total bytes: after the shared 14-byte prefix/header/nonce, graph sample rate u32 at offset 14, RMS u16 at 18 and peak u16 at 20 (values divided by 65535), and flags u8 at 22. All numeric fields are big-endian. Flags: bit 0 near silence, bit 1 clipping observed during capture, bit 2 no signal measurement available, bit 3 browser processing not confirmed off. Unknown versions, lengths, graph rates outside 8–96 kHz, and unknown flag bits are rejected.

Both bodies travel as normal DATA inside separate complete v1 stop-and-wait transfers with the same packet CRC and body CRC. Neither envelope bypasses HELLO/CAPS or verified FIN completion. Receiver arming is explicit and permits one response. After the request's FIN_ACK turnaround, the armed peer sends the reply with the identical nonce. The initiator arms its nonce waiter before sending, requires its request to be acknowledged, ignores stale/wrong-nonce replies, and waits at most 180 seconds for the return body. It then finishes local response FIN_ACK playback before reporting a verified bidirectional challenge. The responder separately reports whether its reply was acknowledged. Cancellation/disposal disarms and terminates pending work. This is a link check, not a claim of measured SNR, reliable distance, or durable authentication. The peer's reported level/processing flags are diagnostics, not trusted sensor attestation.

The application waits up to 45 seconds for the transport to become idle before a calibration reply. Real audio stops on interruption/background/route change and never resumes from protocol timers; a new Start Audio gesture is required. See AUDIO.md for bounded capture/worker behavior and DEVICE_TEST_MATRIX.md for physical validation still outstanding.

## Verified text, image and file transfers

New senders require CONTENT_CAPS before sending any content bytes. Calibration and legacy receivers of raw UTF-8 continue using HELLO/CAPS. The content handshake keeps an older CRC-only receiver from confirming an unverified file.

The ordered reassembly buffer starts with the following manifest. No JSON, MIME string, base64, separate chunk array or second reassembly buffer is required.

| Offset | Width | Meaning |
| --- | --- | --- |
| 0 | u8 | Content version 1 |
| 1 | u8 | Kind 1 UTF-8 text, 2 image, 3 file |
| 2 | u16 big-endian | Raw content size S, including zero for an empty file |
| 4 | u8 | UTF-8 filename length L, 1–64 bytes |
| 5 | 32 bytes | Binary SHA-256 of the S original content bytes |
| 37 | L bytes | Canonical NFC UTF-8 filename |
| 37 + L | S bytes | Exact file, image encoding or UTF-8 text |

The offered body must equal 37 + L + S and fit in 4096 bytes. At most 128 chunks can be negotiated. A receiver checks the offer before allocating its single buffer, checks the declared manifest lengths when the first five bytes arrive and validates the name, digest and text encoding before queuing FIN_ACK. Invalid content is retired and triggers acoustic CANCEL. Sender progress subtracts the entire manifest from the unique ACKed body prefix. The last DATA ACK can reach 100% while FIN verification is still outstanding.

For content DATA only, XOR a deterministic keystream over the chunk before computing its packet CRC. Start with the low 32 bits of (session × 0x85ebca6b) XOR transfer XOR ((sequence + 1) × 0x9e3779b1). Even-numbered transmission attempts use type 10 and additionally XOR 0x27d4eb2f into the seed. Replace a zero seed with one. For each byte advance xorshift32 with left 13, logical right 17, left 5, XORing the state with each shifted result, then XOR its high byte into the payload. Type 3 uses the first mask on odd attempts. Undo the mask after packet CRC verification, before comparing duplicates or writing to reassembly. FIN's body CRC covers the unmasked manifest and content. Both masks occupy exactly one acoustic byte per input byte. Whitening changes repetitive byte patterns that can disrupt ggwave detection. It provides no confidentiality or peer authentication.

## Rate and time display

The raw modulation carries three bytes per six 1024-sample frames at 48 kHz, or 187.5 bit/s before modem framing and FEC. Application goodput divides verified file bytes by actual sender elapsed seconds from handshake start through FIN_ACK, including guards, replies, retries and backoff. Simulation never supplies a microphone measurement. [ggwave protocol definitions](https://github.com/ggerganov/ggwave/blob/master/include/ggwave/ggwave.h)

For N DATA chunks, model 4 + 2N packets. Framed bytes equal manifest + content + 38 control payload bytes + 20 bytes per packet. The initial estimate uses a linear airtime approximation fitted to local 20-byte and 140-byte ggwave outputs (2.091 and 9.259 seconds) and adds a 0.5-second turnaround per packet. With a prior confirmed microphone transfer, scale modeled duration by that transfer's measured elapsed/model ratio, using its negotiated chunk size. The estimate assumes similar conditions and is advisory.

Both pacing policies use baseline Audible Fast. SET_POLICY and POLICY_ACK travel acoustically before dependent DATA. The negotiation rules, timeout recovery and exact overhead are in [ADAPTIVE.md](ADAPTIVE.md).

The paired PCM experiment imposes four DATA attempts per sequence, six extra sender requests across the whole trial and a 120 s wall on the virtual clock. These are experiment controls outside the wire format. Losing the last FIN_ACK can leave a verified receiver receipt while the sender terminates unconfirmed. The ledger therefore reports verified and sender-confirmed payload bytes separately. [Evaluation](BENCHMARKS.md)
