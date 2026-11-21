// Device observations rendered from the existing transceiver inputs.
interface AcousticTickerProps {
  sampleRate?: number;
  listening: boolean;
  ready: boolean;
  isSimulation: boolean;
  speedMode?: 'fast' | 'fastest';
}
export function AcousticTicker({sampleRate,listening,ready,isSimulation,speedMode}:AcousticTickerProps) {
  return <dl className="device-strip" aria-label="Audio settings">
    <div><dt>Audio context</dt><dd>{ready && sampleRate ? sampleRate.toLocaleString()+' Hz' : 'Not started'}</dd></div>
    <div><dt>Mode</dt><dd>{isSimulation ? 'Local PCM simulation' : speedMode === 'fastest' ? 'Audible fastest' : 'Audible fast'}</dd></div>
    <div><dt>Input</dt><dd>{isSimulation?'Simulated PCM':listening?'Listening':'Microphone closed'}</dd></div>
  </dl>;
}
