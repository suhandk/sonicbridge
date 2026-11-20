# Physical acoustic trial sheet

**Status: untested.** A and B are separate laptops. P is a phone. Fill out a copy for each phone/browser pair. Record each attempted transfer, including permission failures and unfinished sends. [Browser and interruption checklist](DEVICE_TEST_MATRIX.md)

| Sender → receiver | Quiet | Repeatable room noise |
| --- | --- | --- |
| Laptop A → laptop B | Untested | Untested |
| Laptop B → laptop A | Untested | Untested |
| Phone P → laptop A | Untested | Untested |
| Laptop A → phone P | Untested | Untested |

**Setup record.** Date, tester, build/cache ID, device models, OS/browser versions, effective mic settings and reported sample rates at both ends: ______. Input and output routes, playback level, distance, orientation, room, noise source/file, level setting, fixed position and start offset: ______. Describe ambient conditions. Enter calibrated sound levels only when actually measured.

1. Load both devices over trusted HTTPS, verify offline readiness, disconnect all networking and reload both. Start Audio, select receiver listening and check the return path by calibration. Record any setup failure. [Phone HTTPS instructions](HTTPS.md)
2. Use the same locally available file, exact bytes, filename and SHA-256 for all paired modes. For each matrix cell do three blocks, each containing all three modes. Rotate the first mode across blocks. Reset audio/controller state between trials. Keep placement and gain fixed, and replay the same noise at the same offset for each paired trial. Record changes to ambient noise.
3. Use a common 120 s stopwatch cutoff from Send. Cancel unfinished transfers at cutoff. Record actual earlier failures at their elapsed time. The shipping modes use their native retry budgets, including up to six DATA attempts in Robust. Mark hardware runs **physical, native budgets**. The software comparison uses a shared cap. Use separate rows for calibration, text, binary and exact-image demo rehearsal.

| Trial/block | Direction/condition | Mode | Filename, bytes, SHA-256 | Receipt verified, hash matches? | FIN_ACK? | Elapsed s | Actual retries / confirmed changes and reason | Terminal outcome |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| | | | | | | | | |

Compare an independent hash of the downloaded bytes with the original. On Windows use `Get-FileHash -Algorithm SHA256 -LiteralPath <path>`. Count a verified file once even if FIN repeats. A verified receiver without FIN_ACK contributes receiver bytes and zero confirmed sender bytes. Record partial delivery as zero verified bytes. Preserve the timeline and diagnostics when available. Microphone recording requires an explicit decision.

Report complete/attempted, each elapsed time, successful latency and mean latency charging incomplete trials 120 s. For each direction, condition and mode divide verified or confirmed bytes by **all** observed transfer seconds, report retries, switches and per-trial range. Show setup failures separately with counts and denominator. Keep trial notes for volume changes, backgrounding and interruptions. Leave hardware range and compatibility open until evidence exists.
