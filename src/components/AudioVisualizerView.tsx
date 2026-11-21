import React, { useEffect, useRef, useState } from 'react';
import type { AudioLink } from '../audio';
import type { AudioDiagnostics } from '../audio-diagnostics';

interface AudioVisualizerProps {
  audio: AudioLink;
  diagnostics: AudioDiagnostics;
  isSimulation?: boolean;
}

export function AudioVisualizerView({ audio, diagnostics, isSimulation }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeTab, setActiveTab] = useState<'spectrum' | 'waveform'>('spectrum');

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = audio.getAnalyser();

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Dark background
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      if (analyser && audio.listening) {
        if (activeTab === 'spectrum') {
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteFrequencyData(dataArray);

          const barWidth = (width / bufferLength) * 2.5;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;
            // Cyan to Teal gradient
            const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
            gradient.addColorStop(0, '#22d3ee');
            gradient.addColorStop(1, '#0891b2');
            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
            x += barWidth;
          }
        } else {
          const bufferLength = analyser.fftSize;
          const dataArray = new Uint8Array(bufferLength);
          analyser.getByteTimeDomainData(dataArray);

          ctx.lineWidth = 2;
          ctx.strokeStyle = '#38bdf8';
          ctx.beginPath();

          const sliceWidth = width / bufferLength;
          let x = 0;

          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.lineTo(width, height / 2);
          ctx.stroke();
        }
      } else {
        // Idle display
        ctx.fillStyle = '#64748b';
        ctx.font = '12px "IBM Plex Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(
          isSimulation
            ? 'LOCAL PCM SIMULATION ACTIVE — HARDWARE MICROPHONE BYPASSED'
            : audio.listening
            ? 'LISTENING — WAITING FOR ACOUSTIC SIGNAL'
            : 'MICROPHONE INACTIVE — TAP "START AUDIO" TO MONITOR LIVE SPECTRUM',
          width / 2,
          height / 2
        );
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [audio, activeTab, isSimulation]);

  return (
    <div className="audio-visualizer-container">
      <div className="visualizer-header">
        <div className="visualizer-title">
          <span className="live-indicator" style={{ background: audio.listening ? '#10b981' : '#f59e0b' }} />
          <span>ACOUSTIC SPECTRUM & WAVEFORM ANALYZER</span>
          <span className="mode-badge-pill">
            {isSimulation ? 'SIMULATION · LOCAL PCM' : 'PHYSICAL AUDIO · LIVE MICROPHONE'}
          </span>
        </div>
        <div className="visualizer-tabs">
          <button
            className={`btn-subtab ${activeTab === 'spectrum' ? 'active' : ''}`}
            onClick={() => setActiveTab('spectrum')}
          >
            FFT Spectrum
          </button>
          <button
            className={`btn-subtab ${activeTab === 'waveform' ? 'active' : ''}`}
            onClick={() => setActiveTab('waveform')}
          >
            Oscilloscope
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} width={640} height={160} className="visualizer-canvas" />

      {/* Device Readiness Checklist */}
      <div className="readiness-checklist">
        <div className="check-item">
          <span className={`status-dot ${diagnostics.contextState === 'running' ? 'ok' : 'pending'}`} />
          <span>Audio Context: <strong>{diagnostics.contextState}</strong></span>
        </div>
        <div className="check-item">
          <span className={`status-dot ${audio.listening ? 'ok' : 'pending'}`} />
          <span>Microphone: <strong>{audio.listening ? 'Active / Listening' : 'Inactive'}</strong></span>
        </div>
        <div className="check-item">
          <span className={`status-dot ${diagnostics.permission.startsWith('granted') ? 'ok' : 'warn'}`} />
          <span>Permission: <strong>{diagnostics.permission}</strong></span>
        </div>
        <div className="check-item">
          <span className="status-dot ok" />
          <span>Modem Codec: <strong>ggwave WASM (Audible Fast)</strong></span>
        </div>
      </div>
    </div>
  );
}
