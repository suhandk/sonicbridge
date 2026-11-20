// Real-time capture/level analysis only; WASM demodulation runs in a dedicated worker.
// Eight recycled buffers bound outstanding PCM to ~128 KiB. Never allocate per quantum.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pool = Array.from({ length: 8 }, () => new Float32Array(4096));
    this.buffer = this.pool.pop(); this.offset = 0; this.startTime = 0;
    this.sum = 0; this.peak = 0; this.clipped = 0; this.count = 0;
    this.quiet = 0; this.dropped = 0;
    this.port.onmessage = ({ data }) => {
      if (data.recycle instanceof Float32Array && data.recycle.length === 4096 && this.pool.length < 8) this.pool.push(data.recycle);
    };
  }
  process(inputs) {
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] / channels.length;
      const amplitude = Math.abs(sample);
      this.sum += sample * sample; this.peak = Math.max(this.peak, amplitude);
      if (amplitude >= 0.98) this.clipped++;
      this.quiet = amplitude < 0.001 ? this.quiet + 1 : 0;
      this.count++;
      if (!this.buffer) { this.buffer = this.pool.pop(); if (this.buffer) { this.offset = 0; this.startTime = currentTime + i / sampleRate; } }
      if (this.buffer) {
        if (!this.offset) this.startTime = currentTime + i / sampleRate;
        this.buffer[this.offset++] = sample;
        if (this.offset === 4096) {
          this.port.postMessage({ pcm: this.buffer, startTime: this.startTime }, [this.buffer.buffer]);
          this.buffer = undefined; this.offset = 0;
        }
      } else this.dropped++;
      if (this.count >= sampleRate / 4) {
        this.port.postMessage({ stats: { rms: Math.sqrt(this.sum / this.count), peak: this.peak, clipped: this.clipped, silenceSeconds: this.quiet / sampleRate, droppedSamples: this.dropped, sampleRate } });
        this.sum = 0; this.peak = 0; this.count = 0;
      }
    }
    return true; // Unwritten outputs are silence; microphone never feeds the speaker.
  }
}
registerProcessor('pcm-capture', PcmCapture);
