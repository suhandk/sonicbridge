// Device observations rendered from the existing transceiver inputs.
interface AcousticTickerProps {
  sampleRate?: number;
  listening: boolean;
  ready: boolean;
  isSimulation: boolean;
  speedMode?: 'fast' | 'fastest';
}
export function AcousticTicker({sampleRate,listening,ready,isSimulation,speedMode}:AcousticTickerProps) {
  return <dl className="device-strip" aria-label="Acoustic Link & Security Telemetry Ticker">
    <div><dt>Audio context</dt><dd>{ready && sampleRate ? sampleRate.toLocaleString()+' Hz' : 'Not started'}</dd></div>
    <div><dt>Mode</dt><dd>{speedMode==='fastest'?'Audible fastest':'Audible fast'}</dd></div>
    <div><dt>Input</dt><dd className={isSimulation?'sim-badge':''}>{isSimulation?'Simulated PCM':listening?'Listening':'Microphone closed'}</dd></div>
  </dl>;
}
