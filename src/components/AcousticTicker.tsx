import React from 'react';

interface AcousticTickerProps {
  sampleRate?: number;
  listening: boolean;
  ready: boolean;
  isSimulation: boolean;
  speedMode?: 'fast' | 'fastest';
  relayCount?: number;
  auditCount?: number;
}

export function AcousticTicker({
  sampleRate = 48000,
  listening,
  ready,
  isSimulation,
  speedMode = 'fastest',
  relayCount = 0,
  auditCount = 0,
}: AcousticTickerProps) {
  const tickerItems = [
    {
      label: 'CARRIER',
      value: `${(sampleRate / 1000).toFixed(1)} kHz`,
      status: ready ? 'ok' : 'idle',
      note: 'WASM MODEM',
    },
    {
      label: 'MODULATION',
      value: speedMode === 'fastest' ? 'AUDIBLE_FASTEST' : 'AUDIBLE_FAST',
      status: speedMode === 'fastest' ? 'active' : 'ok',
      note: speedMode === 'fastest' ? 'TURBO ~4s/chunk' : 'ggwave v1',
    },
    {
      label: 'CRYPTO ENGINE',
      value: 'ECDSA P-256',
      status: 'ok',
      note: 'Web Crypto FIPS 186-4',
    },
    {
      label: 'INTEGRITY LEDGER',
      value: 'SHA-256 LINKED',
      status: 'ok',
      note: `${auditCount} Entries`,
    },
    {
      label: 'AIR-GAP STATUS',
      value: 'DISCONNECTED',
      status: 'ok',
      note: 'Hardware Safe',
    },
    {
      label: 'RELAY MESH',
      value: 'STORE & FORWARD',
      status: relayCount > 0 ? 'warn' : 'ok',
      note: `${relayCount} Queued`,
    },
    {
      label: 'TRANSPORT',
      value: 'STOP & WAIT ARQ',
      status: 'ok',
      note: '120B Chunks · CRC32',
    },
    {
      label: 'PHYSICAL LINK',
      value: isSimulation ? 'VIRTUAL PCM' : listening ? 'LIVE TRANSDUCER' : ready ? 'ARMED' : 'STANDBY',
      status: listening ? 'active' : ready ? 'ok' : 'idle',
      note: isSimulation ? 'Simulation' : 'Acoustic Path',
    },
    {
      label: 'ENVELOPE LIMIT',
      value: '4,096 BYTES',
      status: 'ok',
      note: 'Max Capacity',
    },
  ];

  return (
    <div className="genesis-ticker-wrap" aria-label="Acoustic Link & Security Telemetry Ticker">
      <div className="genesis-ticker-badge">
        <span className="live-pulse-dot" />
        <span className="ticker-badge-text">TELEMETRY</span>
      </div>
      <div className="genesis-ticker-track">
        <div className="genesis-ticker-content">
          {tickerItems.map((item, idx) => (
            <div key={idx} className="ticker-item">
              <span className={`ticker-dot ${item.status}`} />
              <span className="ticker-label">{item.label}:</span>
              <span className="ticker-val">{item.value}</span>
              <span className="ticker-note">[{item.note}]</span>
            </div>
          ))}
        </div>
        {/* Duplicate track for seamless infinite marquee scroll */}
        <div className="genesis-ticker-content" aria-hidden="true">
          {tickerItems.map((item, idx) => (
            <div key={`dup-${idx}`} className="ticker-item">
              <span className={`ticker-dot ${item.status}`} />
              <span className="ticker-label">{item.label}:</span>
              <span className="ticker-val">{item.value}</span>
              <span className="ticker-note">[{item.note}]</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
