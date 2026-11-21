export type RangeTier = 1 | 2 | 3 | 4;
export type RangeSearchPhase = 'idle' | 'expanding' | 'max_power' | 'found' | 'no_receiver';

export interface RangeTierConfig {
  tier: RangeTier;
  name: string;
  gain: number;
  distanceMeters: number;
  freqRange: string;
  chirpFreqStart: number;
  chirpFreqEnd: number;
  description: string;
}

export const RANGE_TIERS: Record<RangeTier, RangeTierConfig> = {
  1: {
    tier: 1,
    name: 'Standard Range',
    gain: 0.60,
    distanceMeters: 15,
    freqRange: '2.0 kHz – 4.5 kHz',
    chirpFreqStart: 2000,
    chirpFreqEnd: 3500,
    description: 'Direct acoustic line-of-sight',
  },
  2: {
    tier: 2,
    name: 'Extended Outreach',
    gain: 0.75,
    distanceMeters: 35,
    freqRange: '1.8 kHz – 3.8 kHz',
    chirpFreqStart: 1800,
    chirpFreqEnd: 3000,
    description: 'Obstacle penetration (moderate foliage)',
  },
  3: {
    tier: 3,
    name: 'Long-Range Penetration',
    gain: 0.90,
    distanceMeters: 70,
    freqRange: '1.5 kHz – 3.0 kHz',
    chirpFreqStart: 1500,
    chirpFreqEnd: 2500,
    description: 'Heavy forest canopy / distance expansion',
  },
  4: {
    tier: 4,
    name: 'Maximum Power Emergency Beacon',
    gain: 1.00,
    distanceMeters: 120,
    freqRange: '1.2 kHz – 2.4 kHz',
    chirpFreqStart: 1200,
    chirpFreqEnd: 2200,
    description: 'Peak acoustic transducer level',
  },
};

export interface RangeExpanderState {
  phase: RangeSearchPhase;
  tier: RangeTier;
  gain: number;
  estimatedDistanceMeters: number;
  frequencyRange: string;
  pulseRadius: number; // 0.0 to 1.0 for circular radar wave expansion
  statusMessage: string;
  attemptCount: number;
  detectedAtDistance?: number;
}

export interface RangeExpanderOptions {
  maxMaxPowerCycles?: number;
  onStateChange?: (state: RangeExpanderState) => void;
  playAcousticPulse?: (tier: RangeTierConfig) => Promise<void>;
  setGain?: (gain: number) => void;
}

export class RangeExpanderEngine {
  private state: RangeExpanderState;
  private options: RangeExpanderOptions;
  private activeAbort?: AbortController;
  private pulseTimer?: ReturnType<typeof setInterval>;
  private maxPowerCycleCount = 0;
  private readonly maxCycles: number;

  constructor(options: RangeExpanderOptions = {}) {
    this.options = options;
    this.maxCycles = options.maxMaxPowerCycles ?? 3;
    this.state = {
      phase: 'idle',
      tier: 1,
      gain: RANGE_TIERS[1].gain,
      estimatedDistanceMeters: RANGE_TIERS[1].distanceMeters,
      frequencyRange: RANGE_TIERS[1].freqRange,
      pulseRadius: 0,
      statusMessage: 'Ready for emergency range search or auto-escalation.',
      attemptCount: 0,
    };
  }

  getState(): RangeExpanderState {
    return { ...this.state };
  }

  private update(patch: Partial<RangeExpanderState>) {
    this.state = { ...this.state, ...patch };
    this.options.onStateChange?.(this.getState());
  }

  /**
   * Triggered when the receiver does NOT send confirmation (ACK timeout during transmission).
   * Distance and sound power escalate ONLY upon unconfirmed attempts.
   */
  handleTransmissionTimeout(missCount: number) {
    if (this.state.phase === 'found') return;

    if (missCount >= 4) {
      this.handleNoReceiverNearby();
      return;
    }

    let targetTier: RangeTier = 1;
    if (missCount === 3) {
      targetTier = 4;
    } else if (missCount === 2) {
      targetTier = 3;
    } else if (missCount === 1) {
      targetTier = 2;
    }

    const tierConfig = RANGE_TIERS[targetTier];
    this.options.setGain?.(tierConfig.gain);

    const isMax = targetTier === 4;
    this.update({
      phase: isMax ? 'max_power' : 'expanding',
      tier: targetTier,
      gain: tierConfig.gain,
      estimatedDistanceMeters: tierConfig.distanceMeters,
      frequencyRange: tierConfig.freqRange,
      attemptCount: missCount,
      statusMessage: isMax
        ? `⚠️ No receiver confirmation at 70m. Escalated to MAX LEVEL (~120m, 100% full scale, low-frequency forest resonance).`
        : `⚠️ No receiver confirmation at ${RANGE_TIERS[(targetTier - 1) as RangeTier]?.distanceMeters ?? 15}m. Escalating distance: ~${tierConfig.distanceMeters}m (${Math.round(tierConfig.gain * 100)}% gain, ${tierConfig.freqRange}).`,
    });
  }

  /**
   * Called when an ACK or peer confirmation arrives.
   * Locks in the receiver at the current distance and halts escalation.
   */
  handleReceiverDetected(confirmedDistance?: number) {
    this.stopBeaconLoop();
    const distance = confirmedDistance ?? this.state.estimatedDistanceMeters;
    this.update({
      phase: 'found',
      detectedAtDistance: distance,
      statusMessage: `🎯 Receiver located & locked at ~${distance}m! Acoustic confirmation (ACK) received.`,
    });
  }

  /**
   * Called when all attempts and max power cycles have been exhausted with zero receiver confirmation.
   */
  handleNoReceiverNearby() {
    this.stopBeaconLoop();
    this.update({
      phase: 'no_receiver',
      statusMessage: `❌ NO RECEIVER NEARBY: Out of audible range (>120m) or peer offline. Receiver did not send confirmation.`,
    });
  }

  /**
   * Sends acoustic discovery probe. Escalates to the next distance tier ONLY
   * if the receiver does NOT return a confirmation within the listening window.
   */
  async startEmergencySearch(mockSimulation = false): Promise<void> {
    this.stop();
    const abort = this.activeAbort = new AbortController();
    this.maxPowerCycleCount = 0;

    // Start animated circular wave expansion
    this.pulseTimer = setInterval(() => {
      this.update({
        pulseRadius: (this.state.pulseRadius + 0.04) % 1.0,
      });
    }, 50);

    for (let t = 1; t <= 4; t++) {
      if (abort.signal.aborted || this.getState().phase === 'found') break;

      const tier = t as RangeTier;
      const tierConfig = RANGE_TIERS[tier];
      this.options.setGain?.(tierConfig.gain);

      const isMax = tier === 4;
      this.update({
        phase: isMax ? 'max_power' : 'expanding',
        tier,
        gain: tierConfig.gain,
        estimatedDistanceMeters: tierConfig.distanceMeters,
        frequencyRange: tierConfig.freqRange,
        attemptCount: t,
        statusMessage: isMax
          ? `Broadcasting MAX POWER acoustic search beacon (~${tierConfig.distanceMeters}m radius)... Waiting for confirmation.`
          : `Pinging distance range ${tierConfig.distanceMeters}m at ${Math.round(tierConfig.gain * 100)}% volume... Waiting for confirmation.`,
      });

      // Play acoustic chirp / beacon pulse
      try {
        if (this.options.playAcousticPulse) {
          await this.options.playAcousticPulse(tierConfig);
        }
      } catch {
        // Audio playback error or interrupted
      }

      // Wait for receiver confirmation window before escalating
      const delayMs = mockSimulation ? 500 : 2200;
      await new Promise(resolve => setTimeout(resolve, delayMs));
      if (abort.signal.aborted || this.getState().phase === 'found') break;
    }

    if (!abort.signal.aborted && this.getState().phase !== 'found') {
      this.handleNoReceiverNearby();
    }
  }

  private stopBeaconLoop() {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = undefined;
    }
    if (this.activeAbort) {
      this.activeAbort.abort();
      this.activeAbort = undefined;
    }
  }

  stop() {
    this.stopBeaconLoop();
    this.update({
      phase: 'idle',
      tier: 1,
      gain: RANGE_TIERS[1].gain,
      estimatedDistanceMeters: RANGE_TIERS[1].distanceMeters,
      pulseRadius: 0,
      statusMessage: 'Emergency search standby.',
    });
  }

  reset() {
    this.stop();
    this.options.setGain?.(RANGE_TIERS[1].gain);
    this.update({
      phase: 'idle',
      tier: 1,
      gain: RANGE_TIERS[1].gain,
      estimatedDistanceMeters: RANGE_TIERS[1].distanceMeters,
      frequencyRange: RANGE_TIERS[1].freqRange,
      pulseRadius: 0,
      attemptCount: 0,
      detectedAtDistance: undefined,
      statusMessage: 'Ready for emergency range search or auto-escalation.',
    });
  }
}
