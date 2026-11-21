export function speakerTestTone(rate: number): Float32Array {
  const duration = .24;
  const samples = new Float32Array(Math.round(rate * duration));
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate;
    const envelope = Math.min(1, time / .025, (duration - time) / .04);
    const phase = 2 * Math.PI * (620 * time + 220 * time * time / duration);
    samples[i] = .4 * envelope * Math.sin(phase);
  }
  return samples;
}
