import type { RangeResult } from '../ranging';

export function AcousticRangeBeacon({ distance, retries, simulation, canTest, testing, onTest }: {
  distance?: RangeResult;
  retries?: number;
  simulation: boolean;
  canTest: boolean;
  testing: boolean;
  onTest: () => void;
}) {
  const measuring = distance?.status === 'measuring';
  return (
    <section className="card acoustic-range-expander" aria-label="Acoustic ranging">
      <div className="card-heading"><h2>Acoustic ranging</h2></div>
      <div className="range-visualizer-layout">
        <div className="radar-container">
          <div className="range-indicator" data-active={measuring || testing} aria-hidden="true">
            <i/><i/><i/><b/>
          </div>
        </div>
        <div className="range-metrics-panel">
          <p className="range-status-banner">
            {simulation ? 'Simulation · distance requires two physical devices' :
              measuring ? 'Measuring distance over sound…' :
                distance?.status === 'estimated' ? `Peer distance ≈ ${distance.metres.toFixed(1)} m` :
                  distance?.status === 'unavailable' ? 'Distance unavailable' : 'Distance is estimated after verified delivery.'}
          </p>
          {retries !== undefined && <p className="fine">Packet retries · {retries}</p>}
          <button type="button" onClick={onTest} disabled={!canTest || testing}>
            {testing ? 'Playing test tone…' : 'Test speaker sound'}
          </button>
        </div>
      </div>
    </section>
  );
}
