// Inventory and a clean, six-byte PCM probe against the installed release.
import factory from 'ggwave';
const g = await factory({ print() {} });
g.disableLog();
console.log('Parameters', g.getDefaultParameters());
console.log('API', Object.keys(g).filter(k => /protocol|encode|decode|^init$|^free$|snr|threshold|duration/i.test(k)));
console.log('Protocols', Object.keys(g.ProtocolId).filter(k => k.startsWith('GGWAVE_')));
const bytes = Buffer.from([83, 66, 0, 255, 1, 42]);
const p = g.getDefaultParameters();
p.sampleFormatInp = p.sampleFormatOut = g.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
for (const name of Object.keys(g.ProtocolId).filter(k => /AUDIBLE|ULTRASOUND|_DT_/.test(k))) {
  const tx = g.init(p), rx = g.init(p);
  try {
    const pcm = Buffer.from(g.encode(tx, bytes, g.ProtocolId[name], 25));
    const input = Buffer.concat([pcm, Buffer.alloc(131072)]);
    let decoded = false;
    for (let i = 0; i + 16384 <= input.length; i += 16384) {
      const result = g.decode(rx, input.subarray(i, i + 16384));
      if (Buffer.from(result).equals(bytes)) decoded = true;
    }
    console.log(name, (pcm.length / (4 * p.sampleRateOut)).toFixed(3), 'seconds, matched:', decoded);
  } finally { g.free(tx); g.free(rx); }
}
