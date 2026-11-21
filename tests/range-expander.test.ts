import { describe, it, expect, vi } from 'vitest';
import { RangeExpanderEngine, RANGE_TIERS } from '../src/range-expander';

describe('Acoustic Range Expander & Emergency Search Beacon', () => {
  it('initializes in idle state at Tier 1 baseline power', () => {
    const expander = new RangeExpanderEngine();
    const state = expander.getState();
    expect(state.phase).toBe('idle');
    expect(state.tier).toBe(1);
    expect(state.gain).toBe(RANGE_TIERS[1].gain);
    expect(state.estimatedDistanceMeters).toBe(RANGE_TIERS[1].distanceMeters);
  });

  it('adaptively escalates sound power and distance when packets time out', () => {
    const gainUpdates: number[] = [];
    const expander = new RangeExpanderEngine({
      setGain: gain => gainUpdates.push(gain),
    });

    // 1 timeout: escalates to Tier 2 (35m, 75% gain)
    expander.handleTransmissionTimeout(1);
    expect(expander.getState().tier).toBe(2);
    expect(expander.getState().phase).toBe('expanding');
    expect(expander.getState().gain).toBe(0.75);
    expect(expander.getState().estimatedDistanceMeters).toBe(35);
    expect(gainUpdates).toContain(0.75);

    // 3 timeouts: escalates to Tier 3 (70m, 90% gain)
    expander.handleTransmissionTimeout(3);
    expect(expander.getState().tier).toBe(3);
    expect(expander.getState().estimatedDistanceMeters).toBe(70);

    // 5 timeouts: escalates to Tier 4 (120m, 100% MAX power)
    expander.handleTransmissionTimeout(5);
    expect(expander.getState().tier).toBe(4);
    expect(expander.getState().phase).toBe('max_power');
    expect(expander.getState().gain).toBe(1.0);
    expect(expander.getState().estimatedDistanceMeters).toBe(120);
  });

  it('locks in receiver when acoustic response is detected', () => {
    const expander = new RangeExpanderEngine();
    expander.handleTransmissionTimeout(2);
    expect(expander.getState().tier).toBe(2);

    // Receiver responds at ~35m
    expander.handleReceiverDetected(38);
    const finalState = expander.getState();
    expect(finalState.phase).toBe('found');
    expect(finalState.detectedAtDistance).toBe(38);
    expect(finalState.statusMessage).toContain('Receiver located & locked at ~38m');
  });

  it('reports "NO RECEIVER NEARBY" when all distance tiers are exhausted without response', () => {
    const expander = new RangeExpanderEngine();
    expander.handleTransmissionTimeout(5);
    expect(expander.getState().phase).toBe('max_power');

    expander.handleNoReceiverNearby();
    const finalState = expander.getState();
    expect(finalState.phase).toBe('no_receiver');
    expect(finalState.statusMessage).toContain('NO RECEIVER NEARBY');
  });

  it('executes progressive automated emergency search beacon sequence', async () => {
    const pulsesPlayed: number[] = [];
    const expander = new RangeExpanderEngine({
      maxMaxPowerCycles: 1,
      playAcousticPulse: async tier => {
        pulsesPlayed.push(tier.tier);
      },
    });

    // Run rapid simulation of search
    await expander.startEmergencySearch(true);

    // Should have stepped through tiers 1, 2, 3, 4
    expect(pulsesPlayed).toContain(1);
    expect(pulsesPlayed).toContain(2);
    expect(pulsesPlayed).toContain(3);
    expect(pulsesPlayed).toContain(4);

    // Without receiver response, terminal state should be no_receiver
    expect(expander.getState().phase).toBe('no_receiver');
  });
});
