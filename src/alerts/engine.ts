import { AlertKind, Process, PROCESS_LABEL, ThermalAlert, ThermalPoint, ThermalProfile } from '../data/types';

export interface AlertSettings {
  onStart: boolean;
  onEnd: boolean;
  onOutOfBand: boolean;
  onDataStopped: boolean;
  vibrate: boolean;
  sound: boolean;
  band: Record<Process, { low: number; high: number }>;
  manualOverride: Record<Process, boolean>;
  fermentStartGap: number;
  fermentEndGap: number;
  fermentHoldMinutes: number;
}

export const DEFAULT_SETTINGS: AlertSettings = {
  onStart: true,
  onEnd: true,
  onOutOfBand: true,
  onDataStopped: false,
  vibrate: true,
  sound: true,
  /**
   * Upper limit is 35 °C for both processes. Beds run near 30 °C in normal
   * operation, so a lower ceiling fires constantly and trains people to ignore
   * alerts. Both limits stay adjustable in Settings.
   */
  band: {
    withering: { low: 20, high: 35 },
    fermentation: { low: 24, high: 35 },
  },
  manualOverride: { withering: false, fermentation: false },
  fermentStartGap: 1.5,
  fermentEndGap: 0.8,
  fermentHoldMinutes: 3,
};

/**
 * How a run is detected, in order of preference.
 *
 * 1. session   The node publishes its own run flag (WTH_SessionActive).
 *              Authoritative — no threshold, no guessing.
 * 2. exotherm  Fermentation generates heat, so the bed sits above the
 *              separately measured ambient. A sustained gap means a run.
 * 3. baseline  Neither field present. Falls back to a rolling average of the
 *              idle temperature and watches for a departure from it.
 */
type Mode = 'session' | 'exotherm' | 'baseline';

const BASELINE: Record<Process, { startDelta: number; endDelta: number; holdMs: number }> = {
  withering: { startDelta: 1.2, endDelta: 0.6, holdMs: 4 * 60_000 },
  fermentation: { startDelta: 0.8, endDelta: 0.5, holdMs: 3 * 60_000 },
};

const STALE_MS = 10 * 60_000;
const REPEAT_BAND_MS = 30 * 60_000;

const uid = () => Math.random().toString(36).slice(2, 10);
const fmtTemp = (n: number) => `${n.toFixed(1)} °C`;

export function fmtDuration(ms: number) {
  const m = Math.round(ms / 60_000);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${String(m % 60).padStart(2, '0')} m` : `${m} m`;
}

export function fmtClock(t: number) {
  return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

type Emit = (a: ThermalAlert) => void;

export class ProcessDetector {
  private baseline: number | null = null;
  private candidateSince: number | null = null;
  private lastPointAt = 0;
  private lastBandAlertAt = 0;
  private staleFired = false;

  constructor(
    private process: Process,
    private deviceId: string,
    private emit: Emit,
  ) {}

  private alert(kind: AlertKind, title: string, body: string, at = Date.now()) {
    this.emit({ id: uid(), kind, process: this.process, deviceId: this.deviceId, title, body, at });
  }

  private modeFor(pt: ThermalPoint): Mode {
    if (pt.sessionActive != null) return 'session';
    if (pt.ambient != null) return 'exotherm';
    return 'baseline';
  }

  onPoint(pt: ThermalPoint, active: ThermalProfile | null, s: AlertSettings): 'start' | 'end' | null {
    if (this.staleFired && this.lastPointAt) {
      const gap = pt.t - this.lastPointAt;
      this.staleFired = false;
      this.alert('data_resumed', 'Readings resumed', `Gap of ${fmtDuration(gap)}, node back online`);
    }
    this.lastPointAt = pt.t;

    if (active) this.checkBand(pt, s);
    if (s.manualOverride[this.process]) return null;

    const mode = this.modeFor(pt);

    // The hardware knows. Trust it, and skip the hold entirely.
    if (mode === 'session') {
      this.candidateSince = null;
      if (pt.sessionActive && !active) return 'start';
      if (!pt.sessionActive && active) return 'end';
      return null;
    }

    if (mode === 'exotherm') {
      const gap = pt.avg - (pt.ambient ?? pt.avg);
      const hold = s.fermentHoldMinutes * 60_000;
      const qualifies = active ? gap <= s.fermentEndGap : gap >= s.fermentStartGap;
      return this.sustained(qualifies, pt.t, hold) ? (active ? 'end' : 'start') : null;
    }

    const cfg = BASELINE[this.process];
    if (!active) {
      this.baseline = this.baseline == null ? pt.avg : this.baseline * 0.9 + pt.avg * 0.1;
      const qualifies = this.baseline != null && Math.abs(pt.avg - this.baseline) >= cfg.startDelta;
      return this.sustained(qualifies, pt.t, cfg.holdMs) ? 'start' : null;
    }
    const startTemp = active.points[0]?.avg ?? pt.avg;
    const qualifies = Math.abs(pt.avg - startTemp) <= cfg.endDelta;
    return this.sustained(qualifies, pt.t, cfg.holdMs) ? 'end' : null;
  }

  /** True once a condition has held continuously for holdMs. */
  private sustained(qualifies: boolean, t: number, holdMs: number) {
    if (!qualifies) {
      this.candidateSince = null;
      return false;
    }
    if (this.candidateSince == null) {
      this.candidateSince = t;
      return false;
    }
    if (t - this.candidateSince >= holdMs) {
      this.candidateSince = null;
      return true;
    }
    return false;
  }

  private checkBand(pt: ThermalPoint, s: AlertSettings) {
    if (!s.onOutOfBand) return;
    const { low, high } = s.band[this.process];
    if (pt.avg <= high && pt.avg >= low) return;
    if (Date.now() - this.lastBandAlertAt < REPEAT_BAND_MS) return;
    this.lastBandAlertAt = Date.now();
    const dir = pt.avg > high ? `above ${high} °C` : `below ${low} °C`;
    this.alert('out_of_band', `${PROCESS_LABEL[this.process]} bed ${dir}`, `Currently ${fmtTemp(pt.avg)}`);
  }

  checkStale(active: ThermalProfile | null, s: AlertSettings) {
    if (!s.onDataStopped || !active || this.staleFired || !this.lastPointAt) return;
    if (Date.now() - this.lastPointAt < STALE_MS) return;
    this.staleFired = true;
    this.alert(
      'data_stopped',
      'Readings stopped',
      `No readings from ${active.location} for ${fmtDuration(Date.now() - this.lastPointAt)}`,
    );
  }

  announceStart(p: ThermalProfile, s: AlertSettings) {
    if (!s.onStart) return null;
    const first = p.points[0];
    const extra = first?.ambient != null ? `, ambient ${fmtTemp(first.ambient)}` : '';
    this.alert(
      'started',
      `${PROCESS_LABEL[p.process]} started`,
      `${p.location} loaded at ${fmtTemp(first?.avg ?? 0)}${extra}`,
      p.startedAt,
    );
    return true;
  }

  announceEnd(p: ThermalProfile, s: AlertSettings) {
    if (!s.onEnd) return null;
    const end = p.points[p.points.length - 1];
    const peak = p.points.reduce((a, b) => (b.max > a.max ? b : a), p.points[0]);
    this.alert(
      'ended',
      `${PROCESS_LABEL[p.process]} finished`,
      `${p.location} ran ${fmtDuration((p.endedAt ?? Date.now()) - p.startedAt)}, ended at ` +
        `${fmtTemp(end?.avg ?? 0)}. Peak was ${fmtTemp(peak?.max ?? 0)} at ${fmtClock(peak?.t ?? 0)}.`,
      p.endedAt ?? Date.now(),
    );
    return true;
  }
}
