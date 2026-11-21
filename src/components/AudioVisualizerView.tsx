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

  const [paused, setPaused] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const listening = audio.listening;
  const live = listening && !isSimulation;
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const pauseOnReducedMotion = () => { if (preference.matches) setPaused(true); };
    preference.addEventListener('change', pauseOnReducedMotion);
    return () => preference.removeEventListener('change', pauseOnReducedMotion);
  }, []);

  useEffect(() => {
    let animId = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = live && !paused ? audio.getAnalyser() : undefined;
    const samples = analyser && new Uint8Array(activeTab === 'spectrum' ? analyser.frequencyBinCount : analyser.fftSize);

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      // Dark background
      ctx.fillStyle = '#111216';
      ctx.fillRect(0, 0, width, height);

      // Grid lines
      ctx.strokeStyle = '#33363d';
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

      if (analyser && samples) {
        if (activeTab === 'spectrum') {
          analyser.getByteFrequencyData(samples);

          const bars = Math.min(96, samples.length);
          const stride = samples.length / bars;
          const barWidth = width / bars;
          ctx.fillStyle = '#ff865b';
          for (let bar = 0; bar < bars; bar++) {
            const start = Math.floor(bar * stride);
            const end = Math.floor((bar + 1) * stride);
            let peak = 0;
            for (let bin = start; bin < end; bin++) peak = Math.max(peak, samples[bin]);
            const barHeight = peak / 255 * height;
            ctx.fillRect(bar * barWidth, height - barHeight, barWidth - 1, barHeight);
          }
        } else {
          analyser.getByteTimeDomainData(samples);

          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ff865b';
          ctx.beginPath();

          const sliceWidth = width / samples.length;
          let x = 0;

          for (let i = 0; i < samples.length; i++) {
            const v = samples[i] / 128.0;
            const y = (v * height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
          }
          ctx.lineTo(width, height / 2);
          ctx.stroke();
        }
      }

      if (analyser) animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [audio, activeTab, live, paused]);

  return (
    <div className="audio-visualizer-container">
      <div className="visualizer-header">
        <div className="visualizer-title">
          <h2>Audio spectrum &amp; waveform</h2>
          <span className="mode-badge-pill">
            {isSimulation ? 'SIMULATION · LOCAL PCM' : 'PHYSICAL AUDIO · LIVE MICROPHONE'}
          </span>
        </div>
        <div className="visualizer-tabs">
          <button
            className={`btn-subtab ${activeTab === 'spectrum' ? 'active' : ''}`}
            aria-pressed={activeTab === 'spectrum'}
            onClick={() => setActiveTab('spectrum')}
          >
            FFT Spectrum
          </button>
          <button
            className={`btn-subtab ${activeTab === 'waveform' ? 'active' : ''}`}
            aria-pressed={activeTab === 'waveform'}
            onClick={() => setActiveTab('waveform')}
          >
            Oscilloscope
          </button>
          <button onClick={() => setPaused(!paused)}>{paused ? 'Resume live plot' : 'Pause live plot'}</button>
        </div>
      </div>

      <p className="visualizer-status">{isSimulation ? 'Local simulation bypasses the microphone.'
        : !listening ? 'Open the microphone in the transceiver to see a live signal.'
        : paused ? 'Live plot paused.' : 'Showing live microphone input.'}</p>
      <canvas role="img" aria-label={activeTab === 'spectrum' ? 'Microphone frequency spectrum' : 'Microphone waveform'} ref={canvasRef} width={640} height={160} className="visualizer-canvas" />

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
