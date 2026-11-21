import React, { useEffect, useRef, useState } from 'react';
import type { AudioLink } from '../audio';
import { active, type Session } from '../session-monitor';
import type { PacketEvent } from '../transport';
import {
  RangeExpanderEngine,
  RANGE_TIERS,
  TRANSFER_REFERENCE_RANGE,
  type RangeExpanderState,
  type RangeTier,
} from '../range-expander';

interface AcousticRangeBeaconProps {
  audioLink?: AudioLink;
  session?: Session;
  packets?: PacketEvent[];
  mode?: string;
  speedMode?: 'fast' | 'fastest';
  onAlert?: (message: string) => void;
}

export function AcousticRangeBeacon({
  audioLink,
  session,
  packets,
  mode = 'microphone',
  speedMode = 'fast',
  onAlert,
}: AcousticRangeBeaconProps) {
  const confirmed = session?.phase === 'completed' || session?.phase === 'received';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<RangeExpanderEngine | null>(null);
  const lastPacketRef = useRef<PacketEvent | null>(null);

  const [state, setState] = useState<RangeExpanderState>({
    phase: 'idle',
    tier: 1,
    gain: RANGE_TIERS[1].gain,
    estimatedDistanceMeters: RANGE_TIERS[1].distanceMeters,
    frequencyRange: RANGE_TIERS[1].freqRange,
    pulseRadius: 0,
    statusMessage: 'Ready: Transmit data to expand range on unconfirmed ACKs, or test speaker.',
    attemptCount: 0,
  });

  // Reliable physical audio tone emitter (guaranteed speaker output via user gesture or active context)
  const playPhysicalSound = async (
    freqStart = 1500,
    freqEnd = 2500,
    durationSec = 0.35,
    gainLevel = 1.0
  ): Promise<void> => {
    try {
      if (audioLink) {
        await audioLink.playBeaconChirp(freqStart, freqEnd, durationSec, gainLevel);
        return;
      }
    } catch {
      // Fallback to standalone AudioContext below
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      const now = ctx.currentTime;
      const targetGain = Math.min(1.0, Math.max(0.1, gainLevel));

      gainNode.gain.setValueAtTime(0.001, now);
      gainNode.gain.linearRampToValueAtTime(targetGain, now + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(Math.max(200, freqStart), now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(200, freqEnd), now + durationSec);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + durationSec);

      await new Promise(resolve => {
        osc.onended = () => {
          try {
            gainNode.disconnect();
            osc.disconnect();
            void ctx.close();
          } catch { /* ignore */ }
          resolve(undefined);
        };
      });
    } catch (e) {
      console.warn('Physical audio playback note:', e);
    }
  };

  // Initialize range expander engine
  useEffect(() => {
    const engine = new RangeExpanderEngine({
      maxMaxPowerCycles: 3,
      onStateChange: s => setState(s),
      setGain: gain => {
        try {
          audioLink?.setPlaybackGain(gain);
        } catch {
          // Audio link might be closed or uninitialized
        }
      },
      playAcousticPulse: async tierConfig => {
        await playPhysicalSound(
          tierConfig.chirpFreqStart,
          tierConfig.chirpFreqEnd,
          0.38,
          tierConfig.gain
        );
      },
    });

    engineRef.current = engine;
    return () => {
      engine.stop();
    };
  }, [audioLink, mode]);

  // React to unconfirmed transmission attempts from packet timeline
  useEffect(() => {
    if (!engineRef.current || !packets || packets.length === 0) return;
    const latest = packets[packets.length - 1];
    if (latest === lastPacketRef.current) return;
    lastPacketRef.current = latest;

    if (latest.direction === 'timeout') {
      // Receiver did NOT send confirmation for this attempt!
      const missCount = latest.attempt ?? 1;
      engineRef.current.handleTransmissionTimeout(missCount);
      const curState = engineRef.current.getState();
      onAlert?.(`⚠️ Receiver did not send confirmation (Attempt ${missCount}): Escalated distance to ~${curState.estimatedDistanceMeters}m (${Math.round(curState.gain * 100)}% gain)`);

      // Play physical penetration tone on unconfirmed timeout escalation
      void playPhysicalSound(
        RANGE_TIERS[curState.tier].chirpFreqStart,
        RANGE_TIERS[curState.tier].chirpFreqEnd,
        0.35,
        curState.gain
      );
    } else if (latest.direction === 'decode') {
      // Receiver SENT confirmation!
      engineRef.current.handleReceiverDetected();
    }
  }, [packets, onAlert]);

  // React to overall session lifecycle
  useEffect(() => {
    if (!engineRef.current || !session) return;

    if (session.phase === 'completed' || session.phase === 'received') {
      engineRef.current.handleReceiverDetected();
    } else if (session.phase === 'failed') {
      engineRef.current.handleNoReceiverNearby();
      onAlert?.('❌ NO RECEIVER NEARBY: Out of audible range (>120m). Receiver did not send confirmation.');
    }
  }, [session, onAlert]);

  // Canvas radar animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const theme = getComputedStyle(canvas);
    const color = (token: string) => theme.getPropertyValue(token).trim();
    const background = color('--space'), border = color('--border'), muted = color('--secondary');
    const orange = color('--orange'), warning = color('--warning'), failure = color('--failure');
    const verified = color('--verified'), mono = color('--mono');
    const radarColor = state.phase === 'no_receiver' ? failure :
      state.phase === 'found' ? verified : state.phase === 'max_power' ? warning : orange;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const pulsing = state.phase === 'expanding' || state.phase === 'max_power';
    let animId: number;
    let waveOffset = 0;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(w, h) * 0.44;

      // Clear dark scope background
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);

      // Radar concentric distance rings
      const rings = [
        { label: '15m (Normal)', radius: maxR * 0.25, tier: 1 },
        { label: '35m (Outreach)', radius: maxR * 0.50, tier: 2 },
        { label: '70m (Canopy)', radius: maxR * 0.75, tier: 3 },
        { label: '120m+ (MAX)', radius: maxR * 1.00, tier: 4 },
      ];

      // Draw crosshairs
      ctx.strokeStyle = border;
      ctx.globalAlpha = .62;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 10);
      ctx.lineTo(cx, h - 10);
      ctx.moveTo(10, cy);
      ctx.lineTo(w - 10, cy);
      ctx.stroke();

      ctx.globalAlpha = 1;

      // Draw static distance rings
      rings.forEach(r => {
        ctx.beginPath();
        ctx.arc(cx, cy, r.radius, 0, Math.PI * 2);
        const isActiveTier = state.tier >= r.tier;
        ctx.strokeStyle = isActiveTier ? radarColor : border;
        ctx.globalAlpha = isActiveTier ? .8 : 1;
        ctx.lineWidth = isActiveTier ? 1.5 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.font = `11px ${mono}`;
        ctx.fillStyle = isActiveTier ? radarColor : muted;
        ctx.fillText(r.label, cx + 6, cy - r.radius + 11);
      });

      // Animated propagating acoustic sound waves (expanding circle form)
      if (pulsing && !motion.matches) {
        waveOffset = (waveOffset + 0.015) % 1.0;
        const activeMaxRadius = rings[state.tier - 1].radius;

        // Render multiple concentric propagating pulses
        for (let i = 0; i < 3; i++) {
          const progress = (waveOffset + i / 3) % 1.0;
          const currentR = progress * activeMaxRadius;
          const opacity = Math.max(0, 1 - progress);

          ctx.beginPath();
          ctx.arc(cx, cy, currentR, 0, Math.PI * 2);

          ctx.strokeStyle = radarColor;
          ctx.globalAlpha = opacity * .8;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Draw Receiver Locked Marker
      if (state.phase === 'found') {
        const lockRadius = confirmed ? RANGE_TIERS[1].distanceMeters : (state.detectedAtDistance ?? RANGE_TIERS[1].distanceMeters);
        const lockDistRatio = Math.min(1.0, lockRadius / RANGE_TIERS[4].distanceMeters);
        const lockR = lockDistRatio * maxR;

        // Pulsing green lock ring
        ctx.beginPath();
        ctx.arc(cx + lockR * 0.7, cy - lockR * 0.7, 10, 0, Math.PI * 2);
        ctx.strokeStyle = verified;
        ctx.lineWidth = 2;
        ctx.shadowColor = verified;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = verified;
        ctx.beginPath();
        ctx.arc(cx + lockR * 0.7, cy - lockR * 0.7, 4, 0, Math.PI * 2);
        ctx.fill();

        // Lock text
        ctx.font = `11px ${mono}`;
        ctx.fillText(confirmed ? TRANSFER_REFERENCE_RANGE : `REFERENCE (~${lockRadius} m)`, cx + lockR * 0.7 + 14, cy - lockR * 0.7 + 4);
      }

      // Draw NO RECEIVER Warning Banner overlay on canvas
      if (state.phase === 'no_receiver') {
        ctx.fillStyle = failure;
        ctx.globalAlpha = .12;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = failure;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = failure;
        ctx.font = `bold 11px ${mono}`;
        ctx.textAlign = 'center';
        ctx.fillText('NO RECEIVER DETECTED IN AUDIBLE RANGE', cx, cy - 14);
        ctx.font = `11px ${mono}`;
        ctx.fillStyle = failure;
        ctx.fillText('>120m OUTREACH EXHAUSTED', cx, cy + 6);
        ctx.textAlign = 'left';
      }

      // Central Transmitter Node
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = radarColor;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (pulsing && !motion.matches) animId = requestAnimationFrame(render);
    };

    const refreshMotion = () => { cancelAnimationFrame(animId); render(); };
    render();
    motion.addEventListener('change', refreshMotion);
    return () => {
      cancelAnimationFrame(animId);
      motion.removeEventListener('change', refreshMotion);
    };
  }, [state, confirmed]);

  const handleStartBeacon = async () => {
    if (!engineRef.current) return;
    onAlert?.('📡 Transmitting acoustic range ping... Escalates to next distance ONLY if receiver confirmation is missing.');
    await engineRef.current.startEmergencySearch(mode === 'simulation');
  };

  const handleTestSound = async () => {
    onAlert?.('🔊 Emitting physical acoustic test tone at 100% volume...');
    await playPhysicalSound(880, 1760, 0.45, 1.0);
  };

  const handleStopBeacon = () => {
    engineRef.current?.stop();
    onAlert?.('Acoustic range search stopped.');
  };

  const handleSimulatePeerFound = () => {
    engineRef.current?.handleReceiverDetected(35);
    onAlert?.('🎯 Simulated result: Receiver ACK confirmed & locked at ~35m!');
  };

  const handleSimulateNoPeer = () => {
    engineRef.current?.handleNoReceiverNearby();
    onAlert?.('⚠️ Simulated result: No receiver nearby (>120m range exhausted without confirmation).');
  };

  return (
    <section className="card acoustic-range-expander" aria-label="Acoustic Range Expander">
      <div className="card-heading">
        <div className="title-with-pill">
          <h2>Adaptive Distance & Acoustic Range Expander</h2>
        </div>
        <span className={`phase-pill phase-${state.phase}`}>
          {state.phase === 'idle' && '⚪ STANDBY'}
          {state.phase === 'expanding' && `🟡 EXPANDING (Tier ${state.tier}/4)`}
          {state.phase === 'max_power' && '🟠 MAXIMUM TRANSMITTER POWER'}
          {state.phase === 'found' && '🟢 RECEIVER LOCKED'}
          {state.phase === 'no_receiver' && '🔴 NO RECEIVER NEARBY'}
        </span>
      </div>

      <p className="fine">
        Missed acknowledgements can raise the playback tier. The radar shows the corresponding reference range.
      </p>

      {/* Radar Display + Live Telemetry Grid */}
      <div className="range-visualizer-layout">
        <div className="radar-container">
          <canvas
            ref={canvasRef}
            width={380}
            height={260}
            className="radar-circle-canvas"
            role="img"
            aria-label="Concentric circular sonar radar showing expanding acoustic sound waves with distance"
          />
        </div>

        <div className="range-metrics-panel">
          <div className="metric-tier-gauge">
            <div className="tier-header">
              <span>Playback tier</span>
              <strong className="mono">{state.tier} of 4 ({RANGE_TIERS[state.tier].name})</strong>
            </div>
            <div className="tier-segments-bar">
              {[1, 2, 3, 4].map(t => (
                <div
                  key={t}
                  className={`tier-segment ${state.tier >= t ? 'active' : ''} ${state.tier === 4 && t === 4 ? 'max-tier' : ''}`}
                >
                  <span>{RANGE_TIERS[t as RangeTier].distanceMeters}m</span>
                </div>
              ))}
            </div>
          </div>

          <div className="range-stat-grid">
            <div className="range-stat-box">
              <span className="stat-label">Acoustic gain</span>
              <strong className={`stat-value ${state.gain >= 1.0 ? 'text-red' : ''}`}>
                {Math.round(state.gain * 100)}% {state.gain >= 1.0 ? '[MAX LEVEL]' : ''}
              </strong>
            </div>

            <div className="range-stat-box">
              <span className="stat-label">Reference range</span>
              <strong className="stat-value mono">
                {confirmed ? TRANSFER_REFERENCE_RANGE : `${state.estimatedDistanceMeters} m`}
              </strong>
            </div>

            <div className="range-stat-box full-width">
              <span className="stat-label">Chirp frequencies</span>
              <span className="stat-detail mono">{state.frequencyRange}</span>
            </div>
          </div>

          {/* Status Alert Banner */}
          <div className={`range-status-banner status-${state.phase}`}>
            {confirmed ? (mode === 'simulation' ? 'Simulation transfer confirmed' : 'Transfer verified') : state.statusMessage}
          </div>
        </div>
      </div>

      {/* Action Controls */}
      <div className="range-actions-bar">
        {state.phase === 'expanding' || state.phase === 'max_power' ? (
          <button
            type="button"
            className="btn-range-action btn-danger"
            onClick={handleStopBeacon}
          >
            ⏹️ Abort Range Ping
          </button>
        ) : (
          <button
            type="button"
            className="btn-range-action btn-primary"
            onClick={handleStartBeacon}
            title="Sends acoustic discovery ping. Escalates to next distance ONLY if no confirmation returns."
          >
            📡 Ping Receiver (Expand on Missing ACK)
          </button>
        )}

        <button
          type="button"
          className="btn-range-action btn-secondary"
          onClick={handleTestSound}
          title="Play physical test sound through device speakers"
        >
          🔊 Test Speaker Sound
        </button>

        <button
          type="button"
          className="btn-range-action btn-secondary"
          onClick={() => engineRef.current?.reset()}
        >
          Reset Baseline
        </button>

        <div className="test-sim-group">
          <button
            type="button"
            className="btn-sim-action"
            onClick={handleSimulatePeerFound}
            title="Simulate peer detected at ~35m"
          >
            🎯 Simulate Lock (~35m)
          </button>
          <button
            type="button"
            className="btn-sim-action"
            onClick={handleSimulateNoPeer}
            title="Simulate no receiver in range"
          >
            ⚠️ Simulate No Receiver
          </button>
        </div>
      </div>
    </section>
  );
}
