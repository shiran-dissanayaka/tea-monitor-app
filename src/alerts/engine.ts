import { AlertKind, Process, PROCESS_LABEL, ThermalAlert, ThermalPoint, ThermalProfile } from '../data/types';

export interface AlertSettings {
  onStart: boolean;
  onEnd: boolean;
  onOutOfBand: boolean;
  onDataStopped: boolean;
  vibrate: boolean;
  sound: boolean;
  band: Record<Process, { low: number; high: number }>;
  /** When true, runs begin and end only when the user says so. */
  manualOverride: Record<Process, boolean>;
}

export const DEFAULT_SETTINGS: AlertSettings = {
  onStart: true,
  onEnd: true,
  onOutOfBand: true,
  onDataStopped: false,
  vibrate: true,
  sound: true,
  band: {
    withering: { low: 20, high: 32 },
    fermentation: { low: 24, high: 29 },
  },
  manualOverride: { withering: false, fermentation: false },
};

/**
 * Detection rule, per Dr. Namal's decision: infer the run from the readings,
 * with a manual override in Settings for when detection is wrong.
 *
 * A run starts when the average departs from the idle baseline by more than
 * `startDelta` and stays there for `holdMs`; it ends when it comes back within
 * `endDelta` for the same hold. Fermentation has a clear exotherm so this is
 * reliable; withering tracks ambient closely, so its margin is deliberately
 * tight and the override matters more there.
 */
const DETECT: Record<Process, { startDelta: number; endDelta: number; holdMs: number }> = {
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

  /** Called for each incoming reading. `active` is the run in progress, if any. */
  onPoint(pt: ThermalPoint, active: ThermalProfile | null, s: AlertSettings): 'start' | 'end' | null {
    const label = PROCESS_LABEL[this.process];

    if (this.staleFired && this.lastPointAt) {
      const gap = pt.t - this.lastPointAt;
      this.staleFired = false;
      this.alert('data_resumed', 'Readings resumed', `Gap of ${fmtDuration(gap)}, camera back online`);
    }
    this.lastPointAt = pt.t;

    if (active) {
      this.checkBand(pt, s);
      if (s.manualOverride[this.process]) return null;
      return this.watchFor('end', pt, active) ? 'end' : null;
    }

    // Idle: track the ambient baseline so a departure is meaningful.
    this.baseline = this.baseline == null ? pt.avg : this.baseline * 0.9 + pt.avg * 0.1;
    if (s.manualOverride[this.process]) return null;
    return this.watchFor('start', pt, null) ? 'start' : null;
  }

  private watchFor(want: 'start' | 'end', pt: ThermalPoint, active: ThermalProfile | null) {
    const cfg = DETECT[this.process];
    let qualifies: boolean;

    if (want === 'start') {
      qualifies = this.baseline != null && Math.abs(pt.avg - this.baseline) >= cfg.startDelta;
    } else {
      const start = active!.points[0]?.avg ?? pt.avg;
      qualifies = Math.abs(pt.avg - start) <= cfg.endDelta;
    }

    if (!qualifies) {
      this.candidateSince = null;
      return false;
    }
    if (this.candidateSince == null) {
      this.candidateSince = pt.t;
      return false;
    }
    if (pt.t - this.candidateSince >= cfg.holdMs) {
      this.candidateSince = null;
      return true;
    }
    return false;
  }

  private checkBand(pt: ThermalPoint, s: AlertSettings) {
    if (!s.onOutOfBand) return;
    const { low, high } = s.band[this.process];
    const out = pt.avg > high || pt.avg < low;
    if (!out) return;
    if (Date.now() - this.lastBandAlertAt < REPEAT_BAND_MS) return;
    this.lastBandAlertAt = Date.now();
    const dir = pt.avg > high ? `above ${high} °C` : `below ${low} °C`;
    this.alert('out_of_band', `Bed ${dir}`, `Currently ${fmtTemp(pt.avg)}`);
  }

  /** Called on a timer, not by a reading — that is the whole point. */
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
    const first = p.points[0]?.avg ?? 0;
    this.alert(
      'started',
      `${PROCESS_LABEL[p.process]} started`,
      `${p.location} loaded at ${fmtTemp(first)}`,
      p.startedAt,
    );
    return true;
  }

  announceEnd(p: ThermalProfile, s: AlertSettings) {
    if (!s.onEnd) return null;
    const end = p.points[p.points.length - 1];
    const peakPt = p.points.reduce((a, b) => (b.max > a.max ? b : a), p.points[0]);
    this.alert(
      'ended',
      `${PROCESS_LABEL[p.process]} finished`,
      `${p.location} ran ${fmtDuration((p.endedAt ?? Date.now()) - p.startedAt)}, ended at ` +
        `${fmtTemp(end?.avg ?? 0)}. Peak was ${fmtTemp(peakPt?.max ?? 0)} at ${fmtClock(peakPt?.t ?? 0)}.`,
      p.endedAt ?? Date.now(),
    );
    return true;
  }
}
