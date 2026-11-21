export interface SignalStats { rms: number; peak: number; clipped: number; silenceSeconds: number; droppedSamples: number; sampleRate: number }
export interface AudioDiagnostics {
  contextState: string; contextRate?: number; trackRate?: number; inputLabel?: string;
  permission: string; processing: string[]; deviceNote: string; signal?: SignalStats;
}
export const PROCESSING_KEYS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const;
export function captureConstraints(supported: MediaTrackSupportedConstraints, deviceId = ''): MediaTrackConstraints {
  const constraints: MediaTrackConstraints = { channelCount: { ideal: 1 } };
  for (const key of PROCESSING_KEYS) if (supported[key]) constraints[key] = { ideal: false };
  if (deviceId && supported.deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}
export function processingReport(supported: MediaTrackSupportedConstraints, settings: MediaTrackSettings) {
  return PROCESSING_KEYS.map(key => {
    if (!supported[key]) return `${key}: request unsupported; effective processing unknown.`;
    if (settings[key] === true) return `${key}: requested off, browser reports ON (request ignored).`;
    if (settings[key] === false) return `${key}: requested off, browser reports off.`;
    return `${key}: requested off; browser does not disclose the effective setting.`;
  });
}
export function signalDescription(signal?: SignalStats) {
  if (!signal) return 'No input measurements yet.';
  if (signal.droppedSamples) return `Capture overflow: ${signal.droppedSamples} samples dropped. Restart audio.`;
  if (signal.clipped) return 'Clipping detected (|sample| ≥ 0.98). Lower sender volume or increase distance.';
  if (signal.silenceSeconds >= 3) return 'Near silence for at least 3 seconds. Check microphone choice, OS input level, and the other device.';
  return `Input ${signal.rms > 0 ? (20 * Math.log10(signal.rms)).toFixed(1) : '−∞'} dBFS · peak ${signal.peak.toFixed(3)}.`;
}
